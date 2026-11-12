const fs = require("node:fs/promises");
const path = require("node:path");
const { withAndroidManifest, withAppBuildGradle, withDangerousMod, withMainApplication } = require("@expo/config-plugins");

function withSmsReader(config) {
  config = withAndroidManifest(config, (config) => {
    const permissions = config.modResults.manifest["uses-permission"] ?? [];
    const requiredPermissions = [
      "android.permission.READ_CALL_LOG",
      "android.permission.READ_SMS",
    ];

    for (const permissionName of requiredPermissions) {
      if (
        !permissions.some(
          (permission) => permission.$["android:name"] === permissionName,
        )
      ) {
        permissions.push({
          $: { "android:name": permissionName },
        });
      }
    }

    config.modResults.manifest["uses-permission"] = permissions;

    const application = config.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error("Não foi possível localizar a aplicação Android.");
    }

    const services = application.service ?? [];
    const screeningService = services.find(
      (service) =>
        service.$["android:name"] === ".SpamCallScreeningService",
    );

    if (!screeningService) {
      services.push({
        $: {
          "android:name": ".SpamCallScreeningService",
          "android:permission": "android.permission.BIND_SCREENING_SERVICE",
          "android:exported": "true",
        },
        "intent-filter": [
          {
            action: [
              {
                $: {
                  "android:name": "android.telecom.CallScreeningService",
                },
              },
            ],
          },
        ],
      });
    }

    application.service = services;
    return config;
  });

  config = withMainApplication(config, (config) => {
    const contents = config.modResults.contents;
    const registration = "add(SmsReaderPackage())";
    const packageListPattern = /(PackageList\(this\)\.packages\.apply\s*\{)/;

    if (!contents.includes(registration)) {
      if (!packageListPattern.test(contents)) {
        throw new Error(
          "Não foi possível registrar SmsReaderPackage em MainApplication.",
        );
      }

      config.modResults.contents = contents.replace(
        packageListPattern,
        `$1\n          ${registration}`,
      );
    }

    return config;
  });

  config = withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;
    if (contents.includes("CMAKE_OBJECT_PATH_MAX")) {
      return config;
    }

    const defaultConfigPattern = /(defaultConfig\s*\{)/;
    if (!defaultConfigPattern.test(contents)) {
      throw new Error(
        "Não foi possível configurar caminhos curtos para a compilação C++ no Windows.",
      );
    }

    config.modResults.contents = contents.replace(
      defaultConfigPattern,
      `$1\n        if (System.getProperty("os.name").toLowerCase().contains("windows")) {\n            externalNativeBuild {\n                cmake {\n                          arguments "-DCMAKE_OBJECT_PATH_MAX=260"\n                }\n            }\n        }`,
    );

    return config;
  });

  return withDangerousMod(config, [
    "android",
    async (config) => {
      const packageName = config.android.package;
      if (!packageName) {
        throw new Error("Defina android.package para gerar o leitor de SMS.");
      }

      const sourcePath = path.join(
        config.modRequest.projectRoot,
        "plugins",
        "SmsReaderModule.kt",
      );
      const destinationPath = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...packageName.split("."),
        "SmsReaderModule.kt",
      );
      const source = await fs.readFile(sourcePath, "utf8");
      const screeningServiceSource = await fs.readFile(
        path.join(
          config.modRequest.projectRoot,
          "plugins",
          "SpamCallScreeningService.kt",
        ),
        "utf8",
      );

      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(
        destinationPath,
        source.replace("__PACKAGE_NAME__", packageName),
      );
      await fs.writeFile(
        path.join(path.dirname(destinationPath), "SpamCallScreeningService.kt"),
        screeningServiceSource.replace("__PACKAGE_NAME__", packageName),
      );

      return config;
    },
  ]);
}

module.exports = withSmsReader;
