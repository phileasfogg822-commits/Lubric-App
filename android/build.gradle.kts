plugins {
    id("com.android.application") version "8.2.0" apply false
    id("org.jetbrains.kotlin.android") version "1.9.22" apply false
    id("com.google.dagger.hilt.android") version "2.48.1" apply false
    id("com.google.devtools.ksp") version "1.9.22-1.0.17" apply false
    id("com.android.library") version "8.2.0" apply false
}

// Versions for dependencies that are declared without a version in the
// individual module build.gradle.kts files (keeps module scripts concise).
val moduleVersions: Map<String, String> = mapOf(
    "androidx.core:core-ktx" to "1.12.0",
    "androidx.appcompat:appcompat" to "1.6.1",
    "com.google.android.material:material" to "1.11.0",
    "androidx.constraintlayout:constraintlayout" to "2.1.4",
    "androidx.lifecycle:lifecycle-runtime-ktx" to "2.7.0",
    "androidx.lifecycle:lifecycle-viewmodel-ktx" to "2.7.0",
    "androidx.lifecycle:lifecycle-viewmodel-compose" to "2.7.0",
    "androidx.lifecycle:lifecycle-runtime-compose" to "2.7.0",
    "androidx.lifecycle:lifecycle-livedata-ktx" to "2.7.0",
    "androidx.navigation:navigation-compose" to "2.7.6",
    "androidx.hilt:hilt-navigation-compose" to "1.1.0",
    "androidx.hilt:hilt-navigation" to "1.1.0",
    "com.google.dagger:hilt-android" to "2.48.1",
    "com.google.dagger:hilt-compiler" to "2.48.1",
    "androidx.room:room-runtime" to "2.6.1",
    "androidx.room:room-ktx" to "2.6.1",
    "androidx.room:room-compiler" to "2.6.1",
    "androidx.datastore:datastore" to "1.0.0",
    "androidx.datastore:datastore-core" to "1.0.0",
    "androidx.datastore:datastore-preferences" to "1.0.0",
    "androidx.datastore:datastore-preferences-core" to "1.0.0",
    "androidx.work:work-runtime-ktx" to "2.9.0",
    "org.jetbrains.kotlinx:kotlinx-coroutines-core" to "1.7.3",
    "org.jetbrains.kotlinx:kotlinx-coroutines-android" to "1.7.3",
)

subprojects {
    afterEvaluate {
        // The Hilt plugin requires its runtime dependencies in every module
        // where the plugin is applied. Adding them here keeps module scripts
        // free of boilerplate and runs before the plugin's own verification.
        if (plugins.hasPlugin("com.google.dagger.hilt.android")) {
            dependencies {
                add("implementation", "com.google.dagger:hilt-android")
                add("ksp", "com.google.dagger:hilt-compiler")
            }
        }

        configurations.configureEach {
            resolutionStrategy.eachDependency {
                if (requested.version.isNullOrEmpty()) {
                    val version = moduleVersions["${requested.group}:${requested.name}"]
                    if (version != null) {
                        useVersion(version)
                    }
                }
            }
        }
    }
}

task("clean", Delete::class) {
    delete(rootProject.buildDir)
}

