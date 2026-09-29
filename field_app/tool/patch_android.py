#!/usr/bin/env python3
"""Let the Android release build reach the shop server over plain HTTP.

Android 9 (API 28) blocks cleartext HTTP by default and Flutter's generated
AndroidManifest.xml does not opt in, so an http:// server is unreachable and
every request fails with a connection error - the app looks like the server is
down when it is perfectly reachable from a browser.

This writes a network security config and points the manifest at it.
Idempotent: safe to run on every build.

TODO(owner): once a domain with a Let's Encrypt certificate is in place, set
cleartextTrafficPermitted="false" in NETWORK_CONFIG below and rebuild. Nothing
else in the app needs to change.
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

    if ATTRIBUTE in source:
        print("manifest already references the network security config")
    else:
        patched, count = re.subn(
            r"<application\b",
            '<application\n        ' + ATTRIBUTE,
            source,
            count=1,
        )
        if count == 0:
            print("ERROR: no <application> tag found in the manifest",
                  file=sys.stderr)
            return 1
        with open(MANIFEST, "w", encoding="utf-8") as fh:
            fh.write(patched)
        print("patched manifest to reference the network security config")

    # Echo the result so the CI log proves it actually took effect - a silent
    # no-op here is exactly the bug this script exists to prevent.
    with open(MANIFEST, encoding="utf-8") as fh:
        tag = re.search(r"<application.*?>", fh.read(), re.S)
    print("--- manifest <application> tag ---")
    print(tag.group(0) if tag else "(not found)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
