# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/android-sdk/tools/proguard/proguard-android.txt
# You can edit the flags in the following section:
# -keepattributes *Annotation*,InnerClasses
# -keep public class public_class_name
# -keep class package_name.package_name
# -keep class package_name.package_name$* {
#     public protected *;
# }

# Gson
-keepattributes *Annotation*
-dontwarn org.codehaus.mojo.animal_sniffer.IgnoreJRERequirement
-dontwarn org.codehaus.mojo.animal_sniffer.annotations.*
-dontwarn sun.misc.**
-dontwarn java.app.**
-dontwarn java.beans.**
-dontwarn javax.annotation.**
-dontwarn kotlin.**
-dontwarn retrofit2.**
-dontwarn com.google.mlkit.**

# Room
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class * {
    *** $PRIMARY_KEY;
}
-keepclassmembers class * {
    @androidx.room.Entity <fields>;
}
-keepclassmembers class * {
    @androidx.room.Query <methods>;
}

# Hilt
-keep class dagger.hilt.** { *; }
-keep class javax.inject.** { *; }
-keep class * extends dagger.hilt.android.lifecycle.HiltViewModel
-keepclassmembers class * {
    @dagger.hilt.android.internal.modules.AndroidEntryPoint <fields>;
}

