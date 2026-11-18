#!/usr/bin/env bash
set -euo pipefail

# Capacitor creates the Android project on CI. Apply the Google Services plugin
# after that generation so google-services.json is processed for FCM.
python3 - <<'PY'
from pathlib import Path
root = Path('android/build.gradle')
app = Path('android/app/build.gradle')
if not root.exists() or not app.exists():
    raise SystemExit('Generated Android Gradle files were not found.')
text = root.read_text()
needle = "classpath 'com.google.gms:google-services:4.4.2'"
if needle not in text:
    if 'dependencies {' not in text:
        raise SystemExit('Could not find root Gradle dependencies block.')
    text = text.replace('dependencies {', 'dependencies {\n        ' + needle, 1)
root.write_text(text)
app_text = app.read_text()
if "id 'com.google.gms.google-services'" not in app_text:
    if 'plugins {' in app_text:
        app_text = app_text.replace('plugins {', "plugins {\n    id 'com.google.gms.google-services'", 1)
    else:
        app_text = "apply plugin: 'com.google.gms.google-services'\n" + app_text
app.write_text(app_text)

# Enable the Google provider in the Capacitor Firebase Authentication plugin.
variables = Path('android/variables.gradle')
if not variables.exists():
    raise SystemExit('Generated android/variables.gradle was not found.')
variables_text = variables.read_text()
additions = []
if 'rgcfaIncludeGoogle' not in variables_text:
    additions.append('    rgcfaIncludeGoogle = true')
if 'androidxCredentialsVersion' not in variables_text:
    additions.append("    androidxCredentialsVersion = '1.3.0'")
if additions:
    marker = 'ext {'
    if marker not in variables_text:
        raise SystemExit('Could not find the ext block in android/variables.gradle.')
    variables_text = variables_text.replace(marker, marker + '\n' + '\n'.join(additions), 1)
    variables.write_text(variables_text)
PY
mkdir -p android/app/src/main/res/raw
cp resources/android/raw/turfbook_alert.wav android/app/src/main/res/raw/turfbook_alert.wav
