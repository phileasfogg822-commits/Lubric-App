package com.lubrcapp.lubrcapp.core.permissions

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * Runtime permission service for Android.
 *
 * Handles permission requests for:
 * - Camera (barcode scanning, document scanning)
 * - Storage (file access, backup/restore)
 * - Location (field sales routing, delivery tracking)
 * - Notifications
 * - Bluetooth (printing)
 * - USB (thermal printers, barcode scanners)
 */
class PermissionService(private val context: Context) {
    fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }

    fun requestPermission(
        activity: androidx.activity.ComponentActivity,
        permission: String,
        requestCode: Int
    ) {
        ActivityCompat.requestPermissions(
            activity,
            arrayOf(permission),
            requestCode
        )
    }

    fun requestPermissions(
        activity: androidx.activity.ComponentActivity,
        permissions: Array<out String>,
        requestCode: Int
    ) {
        ActivityCompat.requestPermissions(
            activity,
            permissions,
            requestCode
        )
    }

    fun hasCameraPermission(): Boolean = hasPermission(Manifest.permission.CAMERA)
    fun hasStoragePermission(): Boolean = hasPermission(Manifest.permission.READ_EXTERNAL_STORAGE) ||
            hasPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
    fun hasLocationPermission(): Boolean = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) ||
            hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
    fun hasNotificationPermission(): Boolean = hasPermission(Manifest.permission.POST_NOTIFICATIONS)
    fun hasBluetoothPermission(): Boolean = hasPermission(Manifest.permission.BLUETOOTH_CONNECT)
    fun hasUsbPermission(): Boolean = hasPermission(Manifest.permission.USB_PERMISSION)
}

object PermissionCodes {
    const val CAMERA = 100
    const val STORAGE = 101
    const val LOCATION = 102
    const val NOTIFICATION = 103
    const val BLUETOOTH = 104
    const val USB = 105
}

