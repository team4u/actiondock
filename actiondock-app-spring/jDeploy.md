# jDeploy Setup Instructions for Coding Agents

These instructions guide you through configuring a Java project to work with jDeploy. No installation of jDeploy is required during setup.

## Table of Contents

1. [Prerequisites Check](#1-prerequisites-check)
2. [Configure Executable JAR Build](#2-configure-executable-jar-build)
3. [Detect App Characteristics](#3-detect-app-characteristics)
4. [Configure package.json](#4-configure-packagejson)
5. [Find and Configure Application Icon](#5-find-and-configure-application-icon)
6. [Add GUI Fallback for Non-GUI Apps](#6-add-gui-fallback-for-non-gui-apps)
7. [Optional: GitHub Workflows](#7-optional-github-workflows)
8. [Build and Validation](#8-build-and-validation)
9. [Publishing via GitHub Releases](#9-publishing-via-github-releases)
10. [How Users Install Your App](#10-how-users-install-your-app)
11. [Compose Multiplatform Desktop Applications](#compose-multiplatform-desktop-applications)
12. [Platform-Specific Builds for Large Native Libraries](#platform-specific-builds-for-large-native-libraries)

---

<!-- section:prerequisites -->
## 1. Prerequisites Check

Verify the project structure:
- Check for `pom.xml` (Maven) or `build.gradle`/`build.gradle.kts` (Gradle)
- Ensure the project builds successfully
- Identify the main class
- Check current JAR output configuration

<!-- /section:prerequisites -->

<!-- section:jar-build -->
## 2. Configure Executable JAR Build

### Preferred: JAR with Dependencies in lib/ Directory

**Maven (using maven-dependency-plugin):**
```xml
<plugin>
   <groupId>org.apache.maven.plugins</groupId>
   <artifactId>maven-dependency-plugin</artifactId>
   <version>3.2.0</version>
   <executions>
      <execution>
         <id>copy-dependencies</id>
         <phase>package</phase>
         <goals>
            <goal>copy-dependencies</goal>
         </goals>
         <configuration>
            <outputDirectory>${project.build.directory}/lib</outputDirectory>
         </configuration>
      </execution>
   </executions>
</plugin>
<plugin>
<groupId>org.apache.maven.plugins</groupId>
<artifactId>maven-jar-plugin</artifactId>
<version>3.2.2</version>
<configuration>
   <archive>
      <manifest>
         <addClasspath>true</addClasspath>
         <classpathPrefix>lib/</classpathPrefix>
         <mainClass>com.example.MainClass</mainClass>
      </manifest>
   </archive>
</configuration>
</plugin>
```

**Gradle (using application plugin):**
```gradle
plugins {
    id 'application'
}

application {
    mainClass = 'com.example.MainClass'
}

task copyDependencies(type: Copy) {
    from configurations.runtimeClasspath
    into "$buildDir/libs/lib"
}

jar {
    dependsOn copyDependencies
    manifest {
        attributes(
            'Main-Class': application.mainClass,
            'Class-Path': configurations.runtimeClasspath.collect { "lib/" + it.getName() }.join(' ')
        )
    }
}
```

### Alternative: Shaded/Fat JAR (if already configured)

If the project already produces a shaded JAR, keep the existing configuration.

### Quarkus Projects

Quarkus apps require an uber-jar for jDeploy distribution. The JAR name follows the pattern `*-runner.jar`.

**Maven:** Add to `application.properties`:
```properties
quarkus.package.jar.type=uber-jar
```
Then build with: `mvn clean package`
Output: `target/<artifactId>-<version>-runner.jar`

**Gradle:** Create a custom build task in `build.gradle`:
```gradle
tasks.register('buildUberJar') {
    group = 'build'
    description = 'Builds an uber-jar with all dependencies included'
    dependsOn 'clean'
    doFirst {
        System.setProperty('quarkus.package.jar.type', 'uber-jar')
    }
    finalizedBy 'quarkusBuild'
}
```
Then build with: `./gradlew buildUberJar`
Output: `build/<artifactId>-<version>-runner.jar`

**Quarkus `@QuarkusMain` for Multi-Modal Apps:**

Quarkus apps that need mode detection (CLI, service, MCP) **must** have a `@QuarkusMain` entry point class. This is because mode detection must happen **before** `Quarkus.run()` is called — if `jdeploy.mode` is `"gui"`, the app should show a GUI fallback instead of starting Quarkus.

If the project already has a `@QuarkusMain` class, inject mode detection there. If not, create one:

```java
import io.quarkus.runtime.Quarkus;
import io.quarkus.runtime.annotations.QuarkusMain;

@QuarkusMain
public class Main {
    public static void main(String... args) {
        String mode = System.getProperty("jdeploy.mode", "");

        if ("gui".equals(mode)) {
            // Show GUI fallback (see Section 6)
            javax.swing.SwingUtilities.invokeLater(() -> {
                javax.swing.JOptionPane.showMessageDialog(
                    null,
                    "MyApp v1.0\n\nThis is a background service.\n"
                        + "Use 'myapp-server service start' to start the service.",
                    "About MyApp",
                    javax.swing.JOptionPane.INFORMATION_MESSAGE
                );
                System.exit(0);
            });
        } else {
            // Launch Quarkus normally for CLI/service/MCP mode
            Quarkus.run(args);
        }
    }
}
```

**Quarkus MCP Server Requirements:**

MCP servers communicate via stdin/stdout, so console output must be suppressed. Add to `application.properties`:
```properties
# Disable banner — it would corrupt MCP protocol on stdout
quarkus.banner.enabled=false

# Disable console logging — stdout must be clean for MCP protocol
quarkus.log.console.enable=false

# Redirect logs to file instead
quarkus.log.file.enabled=true
quarkus.log.file.path=myapp.log
quarkus.log.file.level=INFO
```

For the MCP server dependency (Quarkiverse), add to `pom.xml`:
```xml
<dependency>
    <groupId>io.quarkiverse.mcp</groupId>
    <artifactId>quarkus-mcp-server-stdio</artifactId>
</dependency>
```
(Managed by `quarkus-mcp-server-bom` in `<dependencyManagement>`.)

<!-- /section:jar-build -->

<!-- section:detect-characteristics -->
## 3. Detect App Characteristics

Before configuring package.json, analyze the project to determine what modes the app supports. Check for **all** of the following:

### 3a. Detect JavaFX Usage

```bash
grep -r "import javafx\." src/ --include="*.java" 2>/dev/null | head -5
```

If JavaFX imports are found, set `"javafx": true` in package.json.

### 3b. Detect CLI Capabilities

Look for signs that the app functions as a CLI tool:
- Uses a CLI argument parsing library (picocli, JCommander, Apache Commons CLI, args4j, airline)
- Reads from `System.in` or writes to `System.out`/`System.err` as its primary interface
- Has no GUI framework imports (no Swing, JavaFX, or Compose)
- Uses `args` parameter in `main()` for command dispatch

```bash
# Check for CLI argument parsing libraries
grep -r "import picocli\.\|import com.beust.jcommander\.\|import org.apache.commons.cli\.\|import com.github.rvesse.airline\.\|import com.martiansoftware.jsap\." src/ --include="*.java" 2>/dev/null | head -5

# Check for args4j
grep -r "import org.kohsuke.args4j\." src/ --include="*.java" 2>/dev/null | head -5
```

### 3b-1. Detect Quarkus Entry Point

For Quarkus apps that need mode detection, check if a `@QuarkusMain` class already exists:
```bash
grep -r "@QuarkusMain" src/ --include="*.java" 2>/dev/null
```
If found, inject mode detection there. If not, create a new `@QuarkusMain` class (see [Section 2 — Quarkus Projects](#quarkus-projects)).

### 3c. Detect Service Capabilities

Look for signs the app runs as a long-lived background service:
- Uses a web framework (Spring Boot, Quarkus, Micronaut, Vert.x, Javalin)
- Runs a persistent server loop or listens on a port
- Implements daemon-like behavior
- Has health check endpoints or scheduled tasks

```bash
# Check for web/service frameworks
grep -r "import org.springframework\.\|import io.quarkus\.\|import io.micronaut\.\|import io.vertx\.\|import io.javalin\." src/ --include="*.java" 2>/dev/null | head -5

# Check for server socket usage
grep -r "ServerSocket\|HttpServer\|@RestController\|@Path\|@Controller" src/ --include="*.java" 2>/dev/null | head -5
```

### 3d. Detect MCP Server Capabilities

Look for signs the app implements a Model Context Protocol (MCP) server:
- Uses an MCP SDK library (e.g., `io.modelcontextprotocol`)
- Implements JSON-RPC over stdin/stdout
- Has MCP-related annotations or configuration
- References MCP tools, resources, or prompts

```bash
# Check for MCP SDK usage (standard and Quarkus)
grep -r "import io.modelcontextprotocol\.\|McpServer\|@McpTool\|@McpResource\|mcp-server\|modelcontextprotocol\|quarkus-mcp-server\|io.quarkiverse.mcp" src/ --include="*.java" 2>/dev/null | head -5

# Check build files for MCP dependencies
grep -r "modelcontextprotocol\|mcp-sdk\|mcp-server\|quarkus-mcp-server\|quarkiverse.mcp" pom.xml build.gradle build.gradle.kts 2>/dev/null
```

For Quarkus projects, also check for `@Tool` annotations from `io.quarkiverse.mcp`:
```bash
grep -r "@Tool\|import io.quarkiverse.mcp" src/ --include="*.java" 2>/dev/null | head -5
```

**Note**: If the app is an MCP server, it is also a CLI app (MCP servers communicate over stdin/stdout).

### 3e. Detect GUI Capabilities

Look for signs the app has a graphical user interface:
- Uses Swing (`javax.swing`, `java.awt`)
- Uses JavaFX (`javafx.`)
- Uses Compose Multiplatform (`androidx.compose`)
- Creates windows, frames, or dialogs

```bash
grep -r "import javax.swing\.\|import java.awt\.\|import javafx\.\|import androidx.compose\." src/ --include="*.java" --include="*.kt" 2>/dev/null | head -5
```

### Summary: Classification Decision Tree

After detection, classify the app:

| Has GUI? | Has CLI? | Has Service? | Has MCP? | Classification |
|----------|----------|-------------|----------|----------------|
| Yes | No | No | No | GUI-only app (standard setup) |
| Yes | Yes | No | No | Multi-modal: GUI + CLI |
| No | Yes | No | No | CLI-only app |
| No | No | Yes | No | Service-only app |
| No | Yes | No | Yes | CLI + MCP server |
| No | No | Yes | Yes | Service + MCP server |
| Yes | Yes | Yes | No | Multi-modal: GUI + CLI + Service |

Any app that has CLI, Service, or MCP capabilities needs `jdeploy.commands` in package.json.
Any app without a GUI needs a GUI fallback (see [Section 6](#6-add-gui-fallback-for-non-gui-apps)).

<!-- /section:detect-characteristics -->

<!-- section:package-json -->
## 4. Configure package.json

Create or modify `package.json` in the project root.

### Base Template

```json
{
   "bin": {"{{ appName }}": "jdeploy-bundle/jdeploy.js"},
   "author": "",
   "description": "",
   "main": "index.js",
   "preferGlobal": true,
   "repository": "",
   "version": "1.0.0",
   "jdeploy": {
      "jdk": false,
      "javaVersion": "21",
      "jar": "target/myapp-1.0.jar",
      "javafx": false,
      "title": "My Application"
   },
   "dependencies": {
      "command-exists-promise": "^2.0.2",
      "node-fetch": "2.6.7",
      "tar": "^4.4.8",
      "yauzl": "^2.10.0",
      "shelljs": "^0.8.4"
   },
   "license": "ISC",
   "name": "{{ appName }}",
   "files": ["jdeploy-bundle"],
   "scripts": {"test": "echo \"Error: no test specified\" && exit 1"}
}
```

### Required Fields

- `name`: Unique npm package name
- `bin`: Must include `"jdeploy-bundle/jdeploy.js"`
- `dependencies`: Must include `"shelljs": "^0.8.4"`
- `jdeploy.jar`: Path to executable JAR
- `jdeploy.javaVersion`: Java version required
- `jdeploy.title`: Human-readable application name

### Optional Fields

- `jdeploy.jdk`: Set to `true` if full JDK required (default: `false`)
- `jdeploy.javafx`: Set to `true` for JavaFX apps (default: `false`)
- `jdeploy.args`: Array of JVM arguments
- `jdeploy.buildCommand`: Array of command arguments to build the project automatically before publishing. **Only add if the user explicitly requests automatic builds on publish.**
- `jdeploy.platformBundlesEnabled`: Default `false`. Only set `true` when JAR contains large native libraries (>50MB) for multiple platforms.
- `jdeploy.commands`: Object mapping command names to their configuration (see below)
- `jdeploy.ai.mcp`: MCP server configuration (see below)

### JAR Path Examples by Build Type

| Build Type | JAR Path |
|-----------|----------|
| Maven standard | `target/myapp-1.0.jar` (with `target/lib/`) |
| Maven shaded | `target/myapp-1.0-jar-with-dependencies.jar` |
| Gradle standard | `build/libs/myapp-1.0.jar` (with `build/libs/lib/`) |
| Gradle shadow | `build/libs/myapp-1.0-all.jar` |
| Compose Multiplatform | `compose-desktop/build/libs/compose-desktop-1.0-SNAPSHOT-all.jar` |
| Quarkus uber-jar (Maven) | `target/myapp-1.0-runner.jar` |
| Quarkus uber-jar (Gradle) | `build/myapp-1.0-runner.jar` |

### Configuring Commands (CLI / Service / MCP Apps)

If the app has CLI, service, or MCP capabilities, add a `jdeploy.commands` object. Each key is a command name, and its value is a configuration object with `description` (required), optional `args` (array of static arguments injected by the launcher before user arguments), and optional `implements` (array of roles like `"service_controller"`, `"updater"`, `"launcher"`). Each command creates a CLI executable that gets added to the user's PATH when the app is installed.

When a command is invoked, jDeploy launches the app's JAR with the system property `jdeploy.mode` set to `"command"`. This allows the app to distinguish between GUI and command launch modes.

```json
"jdeploy": {
  "jar": "target/myapp-1.0.jar",
  "javaVersion": "21",
  "title": "My App",
  "commands": {
    "myapp-cmd": {
      "description": "Run My App from the command line"
    }
  }
}
```

**Command name rules:**
- Use lowercase with hyphens (e.g., `my-tool`, `myapp-cli`)
- Must be unique across npm

#### Service Commands

If the app runs as a service (long-lived background process), the command must include `"service_controller"` in its `"implements"` array. This tells jDeploy to add service lifecycle subcommands (`service install`, `service start`, `service stop`, `service status`, `service uninstall`) — all handled by the native launcher. The Java app just needs to start its server logic and stay alive. Optionally add `"updater"` to enable self-update via `<command> update`.

```json
"jdeploy": {
  "jar": "target/myservice-1.0.jar",
  "javaVersion": "21",
  "title": "My Service",
  "commands": {
    "myservice": {
      "description": "My background service",
      "args": ["-Dapp.role=server"],
      "implements": ["service_controller"]
    }
  }
}
```

### Configuring MCP Server

If the app implements an MCP server, add **both** a command in `jdeploy.commands` **and** a `jdeploy.ai.mcp` section (nested inside `jdeploy`). The `ai.mcp` section tells jDeploy installer clients (like Claude Desktop, VS Code, Cursor, etc.) how to register the app as an MCP server.

```json
{
  "name": "my-mcp-tool",
  "version": "1.0.0",
  "jdeploy": {
    "jar": "target/my-mcp-tool-1.0.jar",
    "javaVersion": "21",
    "title": "My MCP Tool",
    "commands": {
      "my-mcp-tool": {
        "description": "An MCP server that provides custom tools",
        "args": ["--mcp-mode"]
      }
    },
    "ai": {
      "mcp": {
        "command": "my-mcp-tool",
        "args": ["--stdio"],
        "defaultEnabled": true
      }
    }
  },
  "bin": {"my-mcp-tool": "jdeploy-bundle/jdeploy.js"},
  "dependencies": {
    "command-exists-promise": "^2.0.2",
    "node-fetch": "2.6.7",
    "tar": "^4.4.8",
    "yauzl": "^2.10.0",
    "shelljs": "^0.8.4"
  },
  "license": "ISC",
  "files": ["jdeploy-bundle"],
  "scripts": {"test": "echo \"Error: no test specified\" && exit 1"}
}
```

**Key points about `jdeploy.ai.mcp`:**
- `command`: Must match a key in `jdeploy.commands`
- `args`: Additional arguments passed when the AI tool invokes the MCP server (optional, default `[]`)
- `defaultEnabled`: Whether the MCP server is auto-enabled during installation (optional, default `false`)

<!-- /section:package-json -->

<!-- section:icon -->
## 5. Find and Configure Application Icon

jDeploy uses an `icon.png` file in the project root (same directory as `package.json`).

### Icon Requirements
- **Format**: PNG
- **Dimensions**: Square (256x256, 512x512, or larger preferred)
- **Location**: Must be named `icon.png` in the project root

### Search Locations (in order)
1. `src/main/resources/` or `src/main/resources/icons/`
2. `resources/`, `assets/`, `images/`
3. Project root directory
4. For Compose: `app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`

### Steps
1. Search for candidate icons:
   ```bash
   find . -name "*.png" -o -name "*.ico" -o -name "*.icns" | grep -i icon
   ```
2. Verify dimensions are square:
   ```bash
   file candidate-icon.png
   ```
3. Copy to project root:
   ```bash
   cp path/to/icon.png ./icon.png
   ```

If no suitable icon exists, skip this step. jDeploy will use a default icon.

<!-- /section:icon -->

<!-- section:gui-fallback -->
## 6. Add GUI Fallback for Non-GUI Apps

**This section applies when**: The app has **no GUI** but will be distributed via jDeploy (which can launch apps in GUI mode). Apps that are purely CLI, service, or MCP-only need a minimal GUI fallback so that when a user double-clicks the app (launching in GUI mode), they see something useful instead of nothing.

### When the jDeploy launcher launches an app, it sets the system property:
- `jdeploy.mode=gui` — when launched as a desktop app (double-click, Start menu, etc.)
- `jdeploy.mode=command` — when launched via a CLI command

### What to implement

Add detection **early** in the `main()` method. If `jdeploy.mode` equals `"gui"` and the app has no GUI of its own, display a simple Swing "About" dialog and exit without proceeding to the CLI/service logic.

### Example implementation (Java)

```java
public static void main(String[] args) {
    String mode = System.getProperty("jdeploy.mode", "");

    if ("gui".equals(mode)) {
        // Show a simple About dialog when launched as a desktop app
        javax.swing.SwingUtilities.invokeLater(() -> {
            javax.swing.JOptionPane.showMessageDialog(
                null,
                "MyApp v1.0\n\nThis is a command-line tool.\nRun 'myapp --help' in a terminal for usage.",
                "About MyApp",
                javax.swing.JOptionPane.INFORMATION_MESSAGE
            );
            System.exit(0);
        });
        return;
    }

    // Normal CLI / service / MCP logic continues here
    // ...
}
```

### Quarkus apps

For Quarkus apps, the GUI fallback must go in the `@QuarkusMain` class, **before** calling `Quarkus.run()`. This prevents Quarkus from starting its container when in GUI mode. See the `@QuarkusMain` example in [Section 2 — Quarkus Projects](#quarkus-projects).

### When NOT to add this

- If the app already has a GUI (Swing, JavaFX, Compose) — it already handles GUI mode.
- If the app is multi-modal and has its own GUI mode handling — don't override it.

<!-- /section:gui-fallback -->

<!-- section:github-workflows -->
## 7. Optional: GitHub Workflows

Create `.github/workflows/jdeploy.yml`:

```yaml
name: jDeploy CI

on:
   push:
      branches:
         - '*-snapshot'
      tags:
         - 'v*'

concurrency:
   group: jdeploy-release-${{ github.repository }}
   cancel-in-progress: false

jobs:
   build:
      permissions:
         contents: write
      runs-on: ubuntu-latest

      steps:
         - uses: actions/checkout@v3
         - name: Set up JDK
           uses: actions/setup-java@v3
           with:
              java-version: '21'  # Match to project's Java version
              distribution: 'temurin'
         - name: Make gradlew executable
           run: chmod +x ./gradlew
         - name: Build with Gradle
           uses: gradle/gradle-build-action@67421db6bd0bf253fb4bd25b31ebb98943c375e1
           with:
              arguments: build
         - name: Build App Installer Bundles
           uses: shannah/jdeploy@master
           with:
              github_token: ${{ secrets.GITHUB_TOKEN }}
         - name: Upload Build Artifacts for DMG Action
           if: ${{ vars.JDEPLOY_CREATE_DMG == 'true' }}
           uses: actions/upload-artifact@v4
           with:
              name: build-target
              path: ./build

   create_and_upload_dmg:
      if: ${{ vars.JDEPLOY_CREATE_DMG == 'true' }}
      name: Create and upload DMG
      permissions:
         contents: write
      runs-on: macos-latest
      needs: build
      steps:
         - name: Set up Git
           run: |
              git config --global user.email "${{ github.actor }}@users.noreply.github.com"
              git config --global user.name "${{ github.actor }}"
         - uses: actions/checkout@v3
         - name: Download Build Artifacts
           uses: actions/download-artifact@v4
           with:
              name: build-target
              path: ./build
         - name: Create DMG and Upload to Release
           uses: shannah/jdeploy-action-dmg@main
           with:
              github_token: ${{ secrets.GITHUB_TOKEN }}
              developer_id: ${{ secrets.MAC_DEVELOPER_ID }}
              developer_certificate_p12_base64: ${{ secrets.MAC_DEVELOPER_CERTIFICATE_P12_BASE64 }}
              developer_certificate_password: ${{ secrets.MAC_DEVELOPER_CERTIFICATE_PASSWORD }}
              notarization_password: ${{ secrets.MAC_NOTARIZATION_PASSWORD }}
```

### npm Publishing Workflow

To publish to the npm registry instead of (or in addition to) GitHub Releases, create `.github/workflows/jdeploy-npm.yml`:

```yaml
name: jDeploy npm Publish

on:
   push:
      branches:
         - '*-snapshot'
      tags:
         - 'v*'

concurrency:
   group: jdeploy-npm-${{ github.repository }}
   cancel-in-progress: false

jobs:
   publish:
      permissions:
         contents: read
         id-token: write
      runs-on: ubuntu-latest

      steps:
         - uses: actions/checkout@v3
         - name: Set up JDK
           uses: actions/setup-java@v3
           with:
              java-version: '21'  # Match to project's Java version
              distribution: 'temurin'
         - name: Build with Maven
           run: mvn clean package -DskipTests
         - name: Publish to npm
           uses: shannah/jdeploy@master
           with:
              deploy_target: npm
              npm_token: ${{ secrets.NPM_TOKEN }}
```

**Key differences from the GitHub Releases workflow:**
- Uses `deploy_target: npm` to publish to npm instead of creating GitHub release assets
- Requires `id-token: write` permission for npm trusted publishing (OIDC provenance)
- Only needs `contents: read` (not `write`) since it doesn't modify the GitHub release
- Requires `NPM_TOKEN` secret or npm trusted publishing configured on npmjs.com
- `package.json` must include a `repository.url` field matching the GitHub repo URL, or npm will reject the publish with an E422 provenance validation error

**For Gradle projects**, replace the Maven build step with:
```yaml
         - name: Make gradlew executable
           run: chmod +x ./gradlew
         - name: Build with Gradle
           run: ./gradlew build -x test
```

<!-- /section:github-workflows -->

<!-- section:build-validation -->
## 8. Build and Validation

1. **Verify Java version compatibility:**
   ```bash
   java -version
   ```
   **IMPORTANT**: Do NOT upgrade the project's Java or Gradle version. Use the project's existing versions in `jdeploy.javaVersion` and the GitHub workflow. Let the project's wrapper (`./gradlew` or `./mvnw`) handle tool versions.

2. **Build the project:**
   - Maven: `mvn clean package`
   - Gradle: `./gradlew build`

3. **Verify JAR is executable:**
   ```bash
   java -jar target/your-app.jar
   ```

4. **Validate package.json paths match actual build output.**

5. **Verify icon setup** (if applicable):
   ```bash
   ls -la icon.png && file icon.png
   ```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| JAR not found | Verify `jdeploy.jar` path matches build output |
| Main class not found | Ensure JAR manifest includes `Main-Class` |
| Missing dependencies | For non-shaded JARs, ensure `lib/` directory is created |
| JavaFX issues | Set `"javafx": true` and verify JavaFX modules are included |
| Quarkus app won't run | Enable uber-jar: `quarkus.package.jar.type=uber-jar` |
| Quarkus MCP corrupted output | Disable console logging and banner in `application.properties` |
| Quarkus ignores `jdeploy.mode` | Create a `@QuarkusMain` class with mode detection before `Quarkus.run()` |

---

<!-- /section:build-validation -->

<!-- section:publishing -->
## 9. Publishing via GitHub Releases

Once your project is configured and builds successfully, you can publish it using GitHub Releases. The jDeploy GitHub Action automatically builds native installers (Windows .exe, macOS .dmg, Linux packages) whenever a GitHub Release is created.

### Prerequisites

- A GitHub repository for your project
- The `gh` CLI installed (for command-line publishing)
- A `.github/workflows/jdeploy.yml` workflow file in your repo (see [Section 7](#7-optional-github-workflows))

### Step-by-Step Publishing

**1. Initialize git and commit your project:**
```bash
cd /path/to/your/project
git init
git add .
git commit -m "Initial commit"
```

**2. Create a GitHub repository and push:**
```bash
# Create a public repo (use --private for private repos)
gh repo create owner/repo-name --public --source . --push
```

**3. Create a GitHub Release to trigger the build:**
```bash
gh release create v1.0.0 --title "v1.0.0" --notes "Initial release"
```

> **Important:** The release must NOT be a draft. Draft releases do not trigger the jDeploy GitHub Action. Use a non-draft release (which is the default for `gh release create`).

**4. Monitor the build:**
- Visit your repository's Actions tab: `https://github.com/owner/repo-name/actions`
- The jDeploy action will build native installers for Windows, macOS, and Linux
- Once complete, the installers are attached to the release as assets

### What Happens During a Release Build

When a non-draft GitHub Release is created:
1. The jDeploy GitHub Action checks out your code
2. Your project is built (Maven or Gradle)
3. jDeploy packages the JAR into native installers for all supported platforms
4. The installers are uploaded as release assets
5. Users can download the appropriate installer for their platform from the release page

### Subsequent Releases

For future versions, simply create a new release:
```bash
gh release create v1.1.0 --title "v1.1.0" --notes "Description of changes"
```

### Verifying Your Release

After the GitHub Action completes, check the release page for installer assets:
```bash
gh release view v1.0.0
```

You should see platform-specific installers (e.g., `.exe`, `.dmg`, `.deb`) attached to the release.

<!-- /section:publishing -->

<!-- section:user-installation -->
## 10. How Users Install Your App

After publishing a GitHub Release, the jDeploy GitHub Action builds native installers and attaches them to the release. Users install your app by downloading the appropriate installer for their platform from the release page.

### Native Installers

The GitHub Action creates:
- **Windows**: `.exe` installer
- **macOS**: `.dmg` disk image
- **Linux**: `.deb` package and other formats

Users download the installer from `https://github.com/<owner>/<repo>/releases/latest` and run it. No Java installation is required — jDeploy bundles the appropriate JRE.

### MCP Server Auto-Registration

If your app is configured as an MCP server (has `jdeploy.ai.mcp` in package.json), the jDeploy installer provides automatic AI tool integration:

1. During installation, the installer detects which AI tools are installed on the user's system
2. It shows an **"Install AI Integrations"** checkbox
3. The user selects which AI tools to register the MCP server with
4. The installer configures the MCP server in each selected tool's configuration file

**Supported AI tools:**

| Tool | Auto-Install |
|------|-------------|
| Claude Desktop | Yes |
| Claude Code | Yes |
| VS Code (Copilot) | Yes |
| Cursor | Yes |
| Windsurf | Yes |
| Gemini CLI | Yes |
| Codex CLI | Yes |
| OpenCode | Yes |

This means users can install your MCP server and have it immediately available in their AI tools — no manual configuration needed.

### When Writing Documentation or Tutorials

When documenting how users install your app:
- **Recommend the native installer** from the GitHub release page as the primary installation method
- For MCP server projects, emphasize that the installer handles AI tool registration automatically
- The release page URL follows the pattern: `https://github.com/<owner>/<repo>/releases/latest`
<!-- /section:user-installation -->

---

<!-- section:compose-multiplatform -->
## Compose Multiplatform Desktop Applications

### Prerequisites

1. Identify the Compose Desktop module (e.g., `compose-desktop`, `desktop`)
2. Verify it has a main function (`src/main/kotlin/main.kt` or similar)
3. Check it uses `compose.desktop.*` dependencies

### Configure Cross-Platform Shadow JAR Build

For cross-platform compatibility, include ALL platform dependencies (not just `compose.desktop.currentOs`).

**Step 1: Add Shadow Plugin** to `build.gradle.kts`:
```kotlin
plugins {
    kotlin("jvm")
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.jetbrainsCompose)
    alias(libs.plugins.shadowPlugin)
    application
}
```

**Step 2: Configure Cross-Platform Dependencies:**
```kotlin
dependencies {
    implementation(compose.desktop.linux_x64)
    implementation(compose.desktop.linux_arm64)
    implementation(compose.desktop.macos_x64)
    implementation(compose.desktop.macos_arm64)
    implementation(compose.desktop.windows_x64)
    // Windows ARM64 not yet supported
    implementation(projects.common)
}

application {
    mainClass.set("MainKt")
}
```

**Step 3: Create Build Task:**
```kotlin
tasks.register("buildExecutableJar") {
    dependsOn("shadowJar")
    doLast {
        println("Built executable JAR")
    }
}
```

### Package.json for Compose

```json
{
  "bin": {"myapp": "jdeploy-bundle/jdeploy.js"},
  "jdeploy": {
    "jdk": false,
    "javaVersion": "21",
    "javafx": false,
    "title": "My Compose App",
    "jar": "compose-desktop/build/libs/compose-desktop-1.0-SNAPSHOT-all.jar"
  }
}
```

### Icon for Compose Projects

Check for Android launcher icons (often the best available):
```bash
find . -path "*/app/src/main/res/mipmap-*/*.png"
cp ./app/src/main/res/mipmap-xxxhdpi/ic_launcher.png ./icon.png
```

### Build and Test

```bash
./gradlew :compose-desktop:buildExecutableJar
ls -lh compose-desktop/build/libs/
java -jar compose-desktop/build/libs/compose-desktop-1.0-SNAPSHOT-all.jar
```

Cross-platform JARs will be ~90MB+ due to native libraries for all platforms. This is expected.

### Compose-Specific Issues

| Problem | Solution |
|---------|----------|
| JAR only works on build platform | Use explicit platform dependencies, not `compose.desktop.currentOs` |
| Large JAR size (~90MB+) | Normal for cross-platform; consider `platformBundlesEnabled` |
| Module not found | Adjust gradle task path (e.g., `:desktop:` vs `:compose-desktop:`) |
| Main class not found | Ensure top-level `fun main() { ... }` and correct `application.mainClass` |

---

<!-- /section:compose-multiplatform -->

<!-- section:platform-specific-builds -->
## Platform-Specific Builds for Large Native Libraries

**Use ONLY when**: JAR contains native libraries >50MB for multiple platforms AND platform-specific builds would reduce size by at least 50%. Do NOT use for standard Java, JavaFX, or small Compose apps.

### Enable Platform Bundles

In `package.json`:
```json
"jdeploy": {
  "platformBundlesEnabled": true
}
```

### Create .jdpignore Files

Create `.jdpignore.<platform>` files in the project root. These use gitignore-style patterns to exclude native libraries not needed for each platform.

**Pattern rules:**
- `/path` — exclude path
- `!/path` — include path (override exclusion)
- `**pattern` — recursive wildcard
- Exclusions are listed first, then platform-specific inclusions override them

**Supported platforms:** `linux-x64`, `linux-arm64`, `mac-x64`, `mac-arm64`, `win-x64`

<details>
<summary><strong>Example .jdpignore files for Compose/Skiko/SQLite/LWJGL</strong></summary>

**`.jdpignore.linux-x64`**
```
!/libskiko-linux-x64.so
/skiko-windows-*.dll
/libskiko-macos-*.dylib
/libskiko-linux-*.so
/skiko-*.dll
/libskiko-*.dylib
/libskiko-*.so
!/org/sqlite/native/Linux/x86_64
/org/sqlite/native
/macos
/windows
/linux
!/linux/x64
**gdx*.dll
**libgdx*.so
/libgdx*.dylib
!/libgdx64.so
```

**`.jdpignore.linux-arm64`**
```
!/libskiko-linux-arm64.so
/skiko-windows-*.dll
/libskiko-macos-*.dylib
/libskiko-linux-*.so
/skiko-*.dll
/libskiko-*.dylib
/libskiko-*.so
!/org/sqlite/native/Linux/aarch64
/org/sqlite/native
/macos
/windows
/linux
!/linux/arm64
**gdx*.dll
**libgdx*.so
/libgdx*.dylib
!/libgdxarm64.so
```

**`.jdpignore.mac-x64`**
```
!/libskiko-macos-x64.dylib
/skiko-windows-*.dll
/libskiko-macos-*.dylib
/libskiko-linux-*.so
/skiko-*.dll
/libskiko-*.dylib
/libskiko-*.so
!/org/sqlite/native/Mac/x86_64
/org/sqlite/native
/linux
/windows
/macos/arm64
**gdx*.dll
**libgdx*.so
/libgdxarm64.dylib
```

**`.jdpignore.mac-arm64`**
```
!/libskiko-macos-arm64.dylib
/skiko-windows-*.dll
/libskiko-macos-*.dylib
/libskiko-linux-*.so
/skiko-*.dll
/libskiko-*.dylib
/libskiko-*.so
!/org/sqlite/native/Mac/aarch64
/org/sqlite/native
/linux
/windows
/macos/x64
**gdx*.dll
**libgdx*.so
/libgdx64.dylib
```

**`.jdpignore.win-x64`**
```
!/skiko-windows-x64.dll
/skiko-windows-*.dll
/libskiko-macos-*.dylib
/libskiko-linux-*.so
/skiko-*.dll
/libskiko-*.dylib
/libskiko-*.so
!/org/sqlite/native/Windows/x86_64
/org/sqlite/native
/linux
/macos
/windows/arm64
/windows/x86
/gdx.dll
**libgdx*.so
**libgdx*.dylib
```

</details>

### How It Works

When `platformBundlesEnabled: true` is set:
1. jDeploy builds the full cross-platform JAR
2. For each platform, creates a filtered JAR using the corresponding `.jdpignore` file
3. Generates separate installers per platform (~30MB each instead of ~90MB)

### Adding Custom Native Libraries

1. Identify the library's native file patterns in the JAR
2. Add broad exclusion: `/library/native`
3. Add platform inclusion: `!/library/native/target-platform`
<!-- /section:platform-specific-builds -->
