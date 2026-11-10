package app.lubric.desktop.data.team

import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.UserEntity

/**
 * Pure permission rules, mirroring `src/lib/permissions.ts` (parsePermissions,
 * getDefaultPermissions, isAdminRole, `can`). Kept free of Room/Android so
 * unit tests can exercise them on the JVM.
 */
object TeamPermissions {

    /** Every permission key the web app knows, in web order. */
    val ALL_PERMISSION_KEYS: List<String> = listOf(
        "dashboard",
        "pos.create",
        "sales_history",
        "catalog.manage",
        "customers",
        "vendors",
        "accounts",
        "expenses.manage",
        "purchase.manage",
        "inspections",
        "reports",
        "profit_loss",
        "team.manage",
        "shop.manage",
        "bill.edit",
        "bill.void",
        "bill.delete",
    )

    /** Roles that bypass every permission check (web ADMIN_ROLES). */
    fun isAdminRole(role: String?): Boolean {
        if (role.isNullOrBlank()) return false
        return role.lowercase() == "admin" || role.lowercase() == "owner"
    }

    /**
     * Normalise whatever the database handed us into a string list.
     * Accepts the raw TEXT column holding JSON; falls back to a comma list
     * so a hand-edited row cannot break the UI (web parsePermissions).
     */
    fun parsePermissions(raw: String?): List<String> {
        if (raw.isNullOrBlank()) return emptyList()
        val trimmed = raw.trim()
        return try {
            // Minimal JSON-array parse without a JSON dependency: the stored
            // form is '["pos.create","customers"]' (serializePermissions).
            if (trimmed.startsWith("[")) {
                trimmed.removePrefix("[").removeSuffix("]")
                    .split(",")
                    .map { it.trim().trim('"') }
                    .filter { it.isNotEmpty() }
            } else {
                trimmed.split(",").map { it.trim() }.filter { it.isNotEmpty() }
            }
        } catch (_: Exception) {
            trimmed.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        }
    }

    /**
     * Sensible starting point when a member is created (web
     * getDefaultPermissions). Cashiers can generate bills and look them up
     * but cannot edit, void or delete a bill; managers get everything except
     * team.manage, shop.manage and bill.delete; admin/owner get everything.
     */
    fun defaultPermissions(role: String): List<String> {
        val r = role.lowercase()
        if (isAdminRole(r)) return ALL_PERMISSION_KEYS
        if (r == "manager") {
            return ALL_PERMISSION_KEYS.filter {
                it != "team.manage" && it != "shop.manage" && it != "bill.delete"
            }
        }
        // cashier (default)
        return listOf("dashboard", "pos.create", "sales_history", "customers")
    }

    /**
     * The permission keys a member effectively holds, for display.
     *
     * - Admin/owner: every known key (their stored list is irrelevant — the
     *   web screen shows "Full access" and ignores the ticks for them).
     * - Anyone else: their own stored `users.permissions` JSON when it
     *   parses to a non-empty list (the web screen shows exactly that);
     *   otherwise the role's `role_permissions` rows (the role defaults).
     */
    fun effectivePermissions(
        role: String,
        userPermissionsJson: String?,
        roleKeys: List<String>,
        allKeys: List<String> = ALL_PERMISSION_KEYS,
    ): List<String> {
        if (isAdminRole(role)) return allKeys
        val own = parsePermissions(userPermissionsJson)
        if (own.isNotEmpty()) return own
        return roleKeys
    }
}

/**
 * Team repository: read-only. The web Team screen also adds/edits members
 * and their permissions, but this phase is read-only by design — no writes
 * here; an admin changes access on the web app.
 *
 * Mirrors `src/modules/team/Team.tsx`: members are users with their role and
 * permission keys; admin/owner members show as "Full access".
 */
class TeamRepository(private val db: LubricDatabase) {

    data class TeamMember(
        val user: UserEntity,
        /** Effective permission keys (see [TeamPermissions.effectivePermissions]). */
        val permissionKeys: List<String>,
    ) {
        /** True for admin/owner roles, which bypass every permission check. */
        val hasFullAccess: Boolean get() = TeamPermissions.isAdminRole(user.role)
        val canEditBills: Boolean get() = permissionKeys.contains("bill.edit")
        val canDeleteBills: Boolean get() = permissionKeys.contains("bill.delete")
    }

    /** All members, ordered by name, each with their effective permission keys. */
    suspend fun teamMembers(): List<TeamMember> {
        val dao = db.teamQueriesDao()
        val users = dao.listUsersByName()
        val byRole = dao.listAllRolePermissions()
            .groupBy({ it.role }, { it.permissionKey })
        val allKeys = dao.allPermissionKeys().ifEmpty { TeamPermissions.ALL_PERMISSION_KEYS }
        return users.map { user ->
            TeamMember(
                user = user,
                permissionKeys = TeamPermissions.effectivePermissions(
                    role = user.role,
                    userPermissionsJson = user.permissions,
                    roleKeys = byRole[user.role].orEmpty(),
                    allKeys = allKeys,
                ),
            )
        }
    }

    /** One member by id, or null. */
    suspend fun teamMemberById(id: Long): TeamMember? {
        val user = db.teamQueriesDao().userById(id) ?: return null
        val roleKeys = db.teamQueriesDao().permissionKeysForRole(user.role)
        val allKeys = db.teamQueriesDao().allPermissionKeys()
            .ifEmpty { TeamPermissions.ALL_PERMISSION_KEYS }
        return TeamMember(
            user = user,
            permissionKeys = TeamPermissions.effectivePermissions(
                role = user.role,
                userPermissionsJson = user.permissions,
                roleKeys = roleKeys,
                allKeys = allKeys,
            ),
        )
    }
}
