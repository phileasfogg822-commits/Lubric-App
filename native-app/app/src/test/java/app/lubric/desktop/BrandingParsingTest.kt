package app.lubric.desktop

import app.lubric.desktop.data.branding.BrandingMapping
import app.lubric.desktop.data.network.ConfigRowDto
import app.lubric.desktop.data.network.FeatureFlagDto
import app.lubric.desktop.data.team.TeamPermissions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrandingParsingTest {

    // -- config rows -> branding ------------------------------------------

    @Test
    fun `missing config keys fall back to defaults`() {
        val branding = BrandingMapping.brandingFromConfig(emptyList())

        assertEquals("LubricApp", branding.appName)
        assertEquals("#2563EB", branding.primaryColor)
        assertNull(branding.defaultBranding)
        assertNull(branding.includedModules)
    }

    @Test
    fun `config rows override defaults and included_modules parses`() {
        val branding = BrandingMapping.brandingFromConfig(
            listOf(
                ConfigRowDto(key = "app_name", value = "Zafar Lubricants"),
                ConfigRowDto(key = "primary_color", value = "#123456"),
                ConfigRowDto(key = "default_branding", value = "zafar"),
                ConfigRowDto(
                    key = "included_modules",
                    value = "[\"dashboard\", \"pos.create\", \"team.manage\"]",
                ),
            ),
        )

        assertEquals("Zafar Lubricants", branding.appName)
        assertEquals("#123456", branding.primaryColor)
        assertEquals("zafar", branding.defaultBranding)
        assertEquals(listOf("dashboard", "pos.create", "team.manage"), branding.includedModules)
    }

    @Test
    fun `blank app_name falls back and malformed included_modules means all included`() {
        val branding = BrandingMapping.brandingFromConfig(
            listOf(
                ConfigRowDto(key = "app_name", value = "   "),
                ConfigRowDto(key = "included_modules", value = "not json at all"),
            ),
        )

        assertEquals("LubricApp", branding.appName)
        assertEquals("#2563EB", branding.primaryColor)
        assertNull(branding.includedModules)
    }

    // -- feature flags ------------------------------------------------------

    @Test
    fun `feature flags parse from JSON and resolve fail-open`() {
        val flags = BrandingMapping.parseFeatureFlags(
            """[
              {"key": "pos.create", "enabled": true, "shop_id": null},
              {"key": "reports", "enabled": false, "shop_id": null},
              {"key": "reports", "enabled": true, "shop_id": 1}
            ]""".trimIndent(),
        )

        assertEquals(3, flags.size)
        assertEquals("pos.create", flags[0].key)
        assertTrue(flags[0].enabled)
        assertFalse(flags[1].enabled)

        // Unknown flag -> enabled (fail open, as seeded on the server).
        assertTrue(BrandingMapping.flagEnabled(flags, "unknown.flag"))
        // Global row says off...
        assertFalse(BrandingMapping.flagEnabled(flags, "reports"))
        // ...but the shop-scoped row wins for shop 1.
        assertTrue(BrandingMapping.flagEnabled(flags, "reports", shopId = 1))
        // And shop 2 falls back to the global row.
        assertFalse(BrandingMapping.flagEnabled(flags, "reports", shopId = 2))
    }

    @Test
    fun `feature flag parsing tolerates blank and malformed JSON`() {
        assertTrue(BrandingMapping.parseFeatureFlags("").isEmpty())
        assertTrue(BrandingMapping.parseFeatureFlags("not json").isEmpty())
        assertTrue(BrandingMapping.flagEnabled(emptyList(), "anything"))
    }

    // -- role -> permission mapping -----------------------------------------

    @Test
    fun `admin and owner get every key regardless of stored permissions`() {
        val keys = TeamPermissions.effectivePermissions(
            role = "admin",
            userPermissionsJson = "[]",
            roleKeys = listOf("dashboard"),
        )
        assertEquals(TeamPermissions.ALL_PERMISSION_KEYS, keys)

        val ownerKeys = TeamPermissions.effectivePermissions(
            role = "Owner",
            userPermissionsJson = null,
            roleKeys = emptyList(),
        )
        assertEquals(TeamPermissions.ALL_PERMISSION_KEYS, ownerKeys)
    }

    @Test
    fun `cashier shows own stored permissions and falls back to role rows`() {
        // Own JSON wins when present (this is what the web screen shows).
        assertEquals(
            listOf("dashboard", "pos.create"),
            TeamPermissions.effectivePermissions(
                role = "cashier",
                userPermissionsJson = "[\"dashboard\", \"pos.create\"]",
                roleKeys = listOf("dashboard", "customers"),
            ),
        )
        // Empty stored list -> the role's role_permissions rows.
        assertEquals(
            listOf("dashboard", "customers"),
            TeamPermissions.effectivePermissions(
                role = "cashier",
                userPermissionsJson = "[]",
                roleKeys = listOf("dashboard", "customers"),
            ),
        )
        // Comma list (hand-edited row) also parses.
        assertEquals(
            listOf("customers", "vendors"),
            TeamPermissions.parsePermissions("customers, vendors"),
        )
        assertTrue(TeamPermissions.parsePermissions(null).isEmpty())
        assertTrue(TeamPermissions.parsePermissions("").isEmpty())
    }

    @Test
    fun `role defaults match the web defaults`() {
        assertEquals(
            listOf("dashboard", "pos.create", "sales_history", "customers"),
            TeamPermissions.defaultPermissions("cashier"),
        )
        val manager = TeamPermissions.defaultPermissions("manager")
        assertFalse(manager.contains("team.manage"))
        assertFalse(manager.contains("shop.manage"))
        assertFalse(manager.contains("bill.delete"))
        assertTrue(manager.contains("bill.edit"))
        assertEquals(
            TeamPermissions.ALL_PERMISSION_KEYS,
            TeamPermissions.defaultPermissions("admin"),
        )
    }
}
