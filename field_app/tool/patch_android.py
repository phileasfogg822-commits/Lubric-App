#!/usr/bin/env python3
"""Make the Android RELEASE build able to reach the shop server at all.

Two separate, well-known Flutter traps, both of which produce the same
symptom - the app says it cannot reach a server that a browser on the very same
phone loads perfectly:

1. Flutter puts the INTERNET permission in the *debug* and *profile* manifests
   only. A release APK therefore ships with NO android.permission.INTERNET and
   every request fails immediately with a connection error.

2. Android 9 (API 28) blocks cleartext HTTP by default and Flutter's main
   manifest never opts in, so an http:// URL is unreachable even with the
   permission present.

This script fixes both, and is idempotent: safe to run on every build.

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

    # --- 1. INTERNET permission ------------------------------------------
    # Without this a release APK cannot make ANY network request.
    if "android.permission.INTERNET" in source:
        print("manifest already declares the INTERNET permission")
    else:
        patched, count = re.subn(
            r"[ \t]*<application\b",
            "    " + PERMISSION + "\n    <application",
            source,
            count=1,
        )
        if count == 0:
            print("ERROR: no <application> tag found in the manifest",
                  file=sys.stderr)
            return 1
        source = patched
        print("ADDED android.permission.INTERNET to the release manifest")

    # --- 2. cleartext HTTP ----------------------------------------------
    if ATTRIBUTE in source:
        print("manifest already references the network security config")
    else:
        patched, count = re.subn(
            r"[ \t]*<application\b",
            "    <application\n        " + ATTRIBUTE,
            source,
            count=1,
        )
        if count == 0:
            print("ERROR: no <application> tag found in the manifest",
                  file=sys.stderr)
            return 1
        source = patched
        print("ADDED android:networkSecurityConfig to the manifest")

    if source != original:
        with open(MANIFEST, "w", encoding="utf-8") as fh:
            fh.write(source)

    # Echo the result so the CI log proves it actually took effect - a silent
    # no-op here is exactly the bug this script exists to prevent.
    print("--- INTERNET permission present? ---")
    print("android.permission.INTERNET" in source)
    print("--- manifest <application> tag ---")
    tag = re.search(r"<application.*?>", source, re.S)
    print(tag.group(0) if tag else "(not found)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
