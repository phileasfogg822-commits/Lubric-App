package app.lubric.desktop.data.team

import androidx.room.Dao
import androidx.room.Query
import app.lubric.desktop.data.db.RolePermissionEntity
import app.lubric.desktop.data.db.UserEntity

/**
 * Read-only queries for the Team & Access screen (`src/modules/team/Team.tsx`).
 *
 * The web screen reads `SELECT id, full_name, email, role, permissions FROM
 * users ORDER BY role, full_name` plus the role defaults from
 * `role_permissions`; this DAO exposes the same rows ordered by name (the
 * role grouping is done by the repository, which resolves each member's
 * effective permission keys). There is no matching DAO in Daos.kt:
 * [app.lubric.desktop.data.db.UserDao] and
 * [app.lubric.desktop.data.db.RolePermissionDao] only expose upsert/count
 * (they serve the sync pull path), so team reads get their own DAO.
 *
 * NOTE FOR THE COORDINATOR: this DAO needs one accessor in
 * LubricDatabase.kt (a file this package may not edit):
 * `abstract fun teamQueriesDao(): TeamQueriesDao`.
 */
@Dao
interface TeamQueriesDao {

    /** All users, ordered by name. */
    @Query("SELECT * FROM users ORDER BY full_name")
    suspend fun listUsersByName(): List<UserEntity>

    /** The permission keys granted to one role (the migration 010 defaults). */
    @Query("SELECT permission_key FROM role_permissions WHERE role = :role")
    suspend fun permissionKeysForRole(role: String): List<String>

    /** Every permission key known to any role (admin/owner "full access"). */
    @Query("SELECT DISTINCT permission_key FROM role_permissions")
    suspend fun allPermissionKeys(): List<String>

    /** All role_permission rows, for grouping by role. */
    @Query("SELECT * FROM role_permissions")
    suspend fun listAllRolePermissions(): List<RolePermissionEntity>

    @Query("SELECT * FROM users WHERE id = :id LIMIT 1")
    suspend fun userById(id: Long): UserEntity?
}
