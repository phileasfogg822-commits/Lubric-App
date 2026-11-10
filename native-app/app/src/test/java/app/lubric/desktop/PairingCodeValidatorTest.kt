package app.lubric.desktop

import app.lubric.desktop.data.sync.PairingCodeValidator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingCodeValidatorTest {

    @Test
    fun `valid 8-hex code is accepted`() {
        assertTrue(PairingCodeValidator.isValid("A1B2C3D4"))
        assertTrue(PairingCodeValidator.isValid("01234567"))
        assertTrue(PairingCodeValidator.isValid("ABCDEF12"))
    }

    @Test
    fun `lowercase input normalizes to upper and is accepted`() {
        assertEquals("A1B2C3D4", PairingCodeValidator.normalize("a1b2c3d4"))
        assertTrue(PairingCodeValidator.isValid("a1b2c3d4"))
        assertTrue(PairingCodeValidator.isValid("abcdef12"))
    }

    @Test
    fun `7 chars rejected`() {
        assertFalse(PairingCodeValidator.isValid("A1B2C3D"))
    }

    @Test
    fun `9 chars rejected`() {
        assertFalse(PairingCodeValidator.isValid("A1B2C3D45"))
    }

    @Test
    fun `non-hex char rejected`() {
        assertFalse(PairingCodeValidator.isValid("A1B2C3G4"))
        assertFalse(PairingCodeValidator.isValid("A1B2C3Z4"))
        assertFalse(PairingCodeValidator.isValid("A1B2-C3D"))
    }

    @Test
    fun `empty rejected`() {
        assertFalse(PairingCodeValidator.isValid(""))
        assertFalse(PairingCodeValidator.isValid("   "))
    }

    @Test
    fun `whitespace trimmed`() {
        assertEquals("A1B2C3D4", PairingCodeValidator.normalize("  a1b2c3d4\n"))
        assertTrue(PairingCodeValidator.isValid("  A1B2C3D4  "))
    }
}
