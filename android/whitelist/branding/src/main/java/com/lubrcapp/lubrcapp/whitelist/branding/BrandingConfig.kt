package com.lubrcapp.lubrcapp.whitelist.branding

import androidx.annotation.ColorInt

/**
 * Branding configuration for white-label deployments.
 *
 * Controls both deployment-level (developer-owned) and customer-level
 * (business owner) branding.
 */
data class BrandingConfig(
    // App identity
    val appName: String = "LubrcApp",
    val productName: String = "LubrcApp",
    val companyName: String = "",
    val shortName: String = "LubrcApp",
    val launcherName: String = "LubrcApp",

    // Colors
    @ColorInt val primaryColor: Int = 0xFF6200EE,
    @ColorInt val secondaryColor: Int = 0xFF03DAC6,
    @ColorInt val accentColor: Int = 0xFF03DAC6,
    @ColorInt val successColor: Int = 0xFF4CAF50,
    @ColorInt val warningColor: Int = 0xFFFFC107,
    @ColorInt val errorColor: Int = 0xFFB00020,

    // Brand assets
    val appLogo: String? = null,
    val launcherIcon: String? = null,
    val adaptiveIcon: String? = null,
    val splashScreenLogo: String? = null,
    val splashScreenBackground: Int? = null,

    // UI settings
    val fontFamily: String? = null,
    val cardStyle: String = "default",
    val buttonStyle: String = "elevated",
    val borderRadius: Int = 16,
    val navigationBarAppearance: String = "dark",
    val lightDarkMode: Boolean = false,
    val systemDefaultTheme: Boolean = true,

    // Document branding
    val invoiceTitle: String = "Invoice",
    val termsUrl: String? = null,
    val privacyUrl: String? = null,
    val website: String? = null,
    val supportContact: String? = null,

    // Custom terms message
    val termsText: String? = null,
    val privacyText: String? = null,

    // Support details
    val supportEmail: String? = null,
    val supportPhone: String? = null,

    // Contact details
    val address: String? = null,
    val phone: String? = null,
    val email: String? = null,
    val taxNumber: String? = null,
    val websiteUrl: String? = null,
)

enum class DocumentTerminology(
    val sale: String,
    val taxInvoice: String,
    val cashMemo: String,
    val quotation: String,
    val estimate: String,
    val customer: String,
    val supplier: String,
    val party: String,
    val item: String,
    val category: String,
    val brand: String,
    val unit: String,
    val warehouse: String,
    val paymentMode: String,
    val expenseCategory: String,
    val otherIncome: String,
)

enum class LanguageCode { EN, UR, AR, HI }

