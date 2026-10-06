# LubrcApp (Android)

White-label business management platform for Android — billing, inventory, accounting, orders, purchases, POS, field-sales, and sync.

## Architecture

- **Clean Architecture** with distinct `domain`, `data`, `feature`, `core`, and `whitelist` module boundaries
- **Kotlin + Jetpack Compose** for UI
- **Multi-module Gradle build** (`app` + ~25 feature, domain, core, and whitelist modules)
- **Hilt** for dependency injection
- **Room** for local database, **WorkManager** for sync queue, **DataStore** for preferences
- **Retrofit + Gson** for REST backend communication
- **CameraX + ML Kit Barcode** for barcode scanning
- **Material3** for theming (light/dark, configurable brand colors)

## Modules

- `app` — Application entry point
- `core/designsystem` — Themed Compose design system, typography, colors, shapes
- `core/auth` — Authentication primitives
- `core/cache` — Memory + disk caching utilities
- `core/network` — Retrofit REST client setup
- `core/permissions` — Android runtime permission handling
- `core/sync` — Sync queue and conflict resolution
- `core/store` — Repository + UseCase layer wrappers
- `core/ui` — Common UI components and navigation
- `domain/*` — Pure Kotlin domain models and business rules
- `feature/*` — Feature modules with Compose UI screens
- `whitelist/*` — White-label configuration engine

## Requirements

- **JDK 17**
- **Android SDK API 26+** (minSdk 26, targetSdk 34)
- **AGP 8.2.x** + **Kotlin 1.9.22**

## Build

```bash
./gradlew :app:assembleDebug
```

## Run

```bash
./gradlew :app:installDebug
```

## Directory Structure

```
android/
  app/
  core/          # DI, theming, security, sync, cache, ui
  domain/        # Business models and use-cases
  feature/       # Screen-level feature modules
  whitelist/     # White-label config engine
```

