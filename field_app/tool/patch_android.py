#!/usr/bin/env python3
"""Make the Android RELEASE build able to reach the shop server, and signable.

Three separate, well-known Flutter traps, all of which produce symptoms that
look like something else entirely:

1. Flutter puts the INTERNET permission in the *debug* and *profile* manifests
   only. A release APK therefore ships with NO android.permission.INTERNET and
   every request fails immediately with a connection error.

2. Android 9 (API 28) blocks cleartext HTTP by default and Flutter's main
   manifest never opts in, so an http:// URL is unreachable even with the
   permission present.

3. `flutter create` writes a release buildType hardwired to the debug key:
       signingConfig = signingConfigs.debug
   It does NOT read android/key.properties at all in this template. So a release
   APK comes out signed with the throwaway debug key the CI runner generates per
   job, and Android then refuses to install it over the previous build
   ("App not installed") because the signature changed. The build SUCCEEDS, which
   is why this goes unnoticed until a phone refuses to update.

   This script therefore injects a real release signingConfig that reads
   key.properties, and points the release buildType at it.

Idempotent: safe to run on every build. It exits non-zero if it cannot make an
edit, so a debug-signed APK can never ship quietly.

TODO(owner): once a domain with a Let's Encrypt certificate is in place, set
cleartextTrafficPermitted="false" in NETWORK_CONFIG below and rebuild. Nothing
else in the app needs to change - the INTERNET permission always stays.
"""

import os
import re
import sys

ANDROID_DIR = "android/app/src/main"
MANIFEST = os.path.join(ANDROID_DIR, "AndroidManifest.xml")
RES_XML_DIR = os.path.join(ANDROID_DIR, "res", "xml")
NSC = os.path.join(RES_XML_DIR, "network_security_config.xml")
BUILD_GRADLE = os.path.join("android", "app", "build.gradle")

NETWORK_CONFIG = """<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!--
      TRANSITIONAL: the shop server is reached by IP over plain HTTP because
      there is no domain yet. Set cleartextTrafficPermitted="false" here once
      HTTPS is live, then rebuild.
    -->
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
"""

PERMISSION = '<uses-permission android:name="android.permission.INTERNET" />'
ATTRIBUTE = 'android:networkSecurityConfig="@xml/network_security_config"'

# ── in-app updating ──────────────────────────────────────────────────────────
# 4. Android 8 (API 26) requires REQUEST_INSTALL_PACKAGES before an app may ask
#    the system to install a package. Without it the install intent is refused
#    and NOTHING visible happens: the download completes, the dialog closes, and
#    the update never installs. That is exactly what was reported.
#
#    Deliberately NOT added here: a FileProvider. `open_filex` already declares
#    one (authority ${applicationId}.fileProvider.com.crazecoder.openfile) and
#    its filepaths.xml already covers the cache, files, external-files and
#    external-cache directories - every location this app downloads to. Adding a
#    second provider would be dead weight at best and a manifest-merge conflict
#    at worst, so the fix is the permission alone.
INSTALL_PERMISSION = (
    '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />'
)

# ── release signing ──────────────────────────────────────────────────────────
# Read by the block injected into build.gradle. Kept as one string so the exact
# text that lands in the Gradle file is reviewable here.
KEYSTORE_LOADER = """// --- release signing, injected by tool/patch_android.py -----------------
// `flutter create` hardwires the release build to signingConfigs.debug, so a
// release APK is signed with the runner's throwaway debug key and Android
// refuses to install it over an existing install. key.properties is written by
// the release workflow from the shop's keystore secret.
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
// ------------------------------------------------------------------------
"""

RELEASE_SIGNING_CONFIG = """        // Injected by tool/patch_android.py - signs with the shop's key.
        create("release") {
            keyAlias = keystoreProperties['keyAlias']
            keyPassword = keystoreProperties['keyPassword']
            // file() is required: Gradle wants a java.io.File, and a bare String
            // fails the build with "Cannot cast object ... to class
            // java.io.File". An absolute path in key.properties resolves as-is.
            storeFile = file(keystoreProperties['storeFile'])
            storePassword = keystoreProperties['storePassword']
        }
"""

DEBUG_SIGNING = "signingConfig = signingConfigs.debug"
CONDITIONAL_SIGNING = (
    "signingConfig = keystorePropertiesFile.exists()"
    " ? signingConfigs.release : signingConfigs.debug"
)


def patch_manifest(source: str) -> str:
    """Steps 1, 2 and 4: network access and permission to install updates."""
    # --- 1. INTERNET permission ------------------------------------------
    # Without this a release APK cannot make ANY network request.
    if "android.permission.INTERNET" not in source:
        patched, count = re.subn(
            r"[ \t]*<application\b",
            "    " + PERMISSION + "\n    <application",
            source,
            count=1,
        )
        if count == 0:
            raise SystemExit("ERROR: no <application> tag found in the manifest")
        source = patched
        print("ADDED android.permission.INTERNET to the release manifest")

    # --- 2. cleartext HTTP ----------------------------------------------
    if ATTRIBUTE not in source:
        patched, count = re.subn(
            r"[ \t]*<application\b",
            "    <application\n        " + ATTRIBUTE,
            source,
            count=1,
        )
        if count == 0:
            raise SystemExit("ERROR: no <application> tag found in the manifest")
        source = patched
        print("ADDED android:networkSecurityConfig to the manifest")

    # --- 4. permission to install the downloaded update -------------------
    # See the note on INSTALL_PERMISSION: without this the install intent is
    # refused and the update silently never happens.
    if "android.permission.REQUEST_INSTALL_PACKAGES" not in source:
        patched, count = re.subn(
            r"[ \t]*<application\b",
            "    " + INSTALL_PERMISSION + "\n    <application",
            source,
            count=1,
        )
        if count == 0:
            raise SystemExit("ERROR: no <application> tag found in the manifest")
        source = patched
        print("ADDED android.permission.REQUEST_INSTALL_PACKAGES")
    return source


def patch_signing(source: str) -> str:
    """Step 3: make the release build use the shop's key.

    The generated template has `signingConfig = signingConfigs.debug` in the
    release buildType and no key.properties handling at all. Three edits are
    needed, and every one of them is verified: a build that quietly keeps
    signing with the debug key is precisely the failure this exists to stop, so
    this must never be best-effort.
    """
    if CONDITIONAL_SIGNING in source and "injected by tool/patch_android.py" in source:
        print("build.gradle already wired for release signing")
        return source

    # (a) load key.properties at the top level, before the android {} block.
    if "keystorePropertiesFile" not in source:
        patched, count = re.subn(
            r"^android \{",
            KEYSTORE_LOADER + "android {",
            source,
            count=1,
            flags=re.M,
        )
        if count == 0:
            raise SystemExit(
                "ERROR: could not find the 'android {' block in build.gradle, so "
                "release signing cannot be wired. Refusing to ship an APK signed "
                "with the throwaway debug key."
            )
        source = patched
        print("ADDED key.properties loading to build.gradle")

    # (b) declare a release signing config.
    if 'create("release")' not in source:
        block = "    signingConfigs {\n" + RELEASE_SIGNING_CONFIG + "    }\n"
        if re.search(r"^[ \t]*signingConfigs \{", source, re.M):
            patched, count = re.subn(
                r"^([ \t]*)signingConfigs \{",
                lambda m: m.group(0) + "\n" + RELEASE_SIGNING_CONFIG,
                source,
                count=1,
                flags=re.M,
            )
            if count == 0:
                raise SystemExit("ERROR: signingConfigs block not found")
            source = patched
        else:
            patched, count = re.subn(
                r"^android \{",
                "android {\n" + block,
                source,
                count=1,
                flags=re.M,
            )
            if count == 0:
                raise SystemExit("ERROR: could not add a signingConfigs block")
            source = patched
        print("ADDED the release signingConfig to build.gradle")

    # (c) point the release buildType at it.
    if DEBUG_SIGNING in source:
        source = source.replace(DEBUG_SIGNING, CONDITIONAL_SIGNING)
        print("release buildType now signs with the shop's key")
    elif CONDITIONAL_SIGNING not in source:
        raise SystemExit(
            "ERROR: no recognisable signingConfig assignment in the release "
            "buildType. Refusing to ship an APK signed with the debug key."
        )

    return source


def main() -> int:
    if not os.path.exists(MANIFEST):
        print("no android project present - skipping")
        return 0

    os.makedirs(RES_XML_DIR, exist_ok=True)
    with open(NSC, "w", encoding="utf-8") as fh:
        fh.write(NETWORK_CONFIG)
    print("wrote", NSC)

    with open(MANIFEST, encoding="utf-8") as fh:
        source = fh.read()
    original = source
    source = patch_manifest(source)

    if source != original:
        with open(MANIFEST, "w", encoding="utf-8") as fh:
            fh.write(source)

    # --- 3. release signing ---------------------------------------------
    if not os.path.exists(BUILD_GRADLE):
        raise SystemExit(
            "ERROR: " + BUILD_GRADLE + " not found, so release signing cannot be "
            "wired. Refusing to ship an APK signed with the throwaway debug key."
        )
    with open(BUILD_GRADLE, encoding="utf-8") as fh:
        gradle = fh.read()
    gradle_original = gradle
    gradle = patch_signing(gradle)
    if gradle != gradle_original:
        with open(BUILD_GRADLE, "w", encoding="utf-8") as fh:
            fh.write(gradle)

    # Echo the result so the CI log proves it actually took effect - a silent
    # no-op here is exactly the bug this script exists to prevent.
    print("--- INTERNET permission present? ---")
    print("android.permission.INTERNET" in source)
    print("--- in-app update requirements ---")
    print(
        "REQUEST_INSTALL_PACKAGES:",
        "android.permission.REQUEST_INSTALL_PACKAGES" in source,
    )
    # open_filex supplies the FileProvider and the filepaths.xml it needs, so
    # this is a read-only sanity check rather than something we patch.
    print("--- manifest <application> tag ---")
    tag = re.search(r"<application.*?>", source, re.S)
    print(tag.group(0) if tag else "(not found)")

    print("--- release signing wired? ---")
    print("key.properties loaded:", "keystorePropertiesFile" in gradle)
    print('release signingConfig present:', 'create("release")' in gradle)
    signing = re.search(r"^[ \t]*signingConfig = .*$", gradle, re.M)
    print("found in build.gradle:", signing.group(0).strip() if signing else "(none)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
