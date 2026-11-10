package app.lubric.desktop.data.sync

/**
 * Pairing-code validation, mirroring the server: codes are 8 uppercase
 * hex chars (`crypto.randomBytes(4)`), looked up upper-cased and trimmed.
 */
object PairingCodeValidator {

    /** Trim + uppercase, matching the server's lookup. */
    fun normalize(code: String): String = code.trim().uppercase()

    /** Exactly 8 chars, all 0-9 / A-F, after [normalize]. */
    fun isValid(code: String): Boolean {
        val normalized = normalize(code)
        return normalized.length == 8 && normalized.all { it in '0'..'9' || it in 'A'..'F' }
    }
}
