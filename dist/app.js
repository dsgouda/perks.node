#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const console_1 = require("@microsoft.azure/console");
const os = require("os");
const path = require("path");
const dotnet = require("./main");
const printablePath = (path) => path.replace(/\\/g, "\\\\");
const pathOption = {
    alias: 'p',
    describe: '**installation root folder**',
    default: path.normalize(`${os.homedir()}/.dotnet`)
};
const osOption = {
    alias: 'o',
    describe: '**use specific operating system id**',
    choices: dotnet.getAllOperatingSystems(),
    default: dotnet.detectOperatingSystem("2.0")
};
const archOption = {
    alias: 'a',
    describe: '**use specific operating system**',
    choices: dotnet.getAllArchitectures(),
    default: os.arch()
};
let exitCode = Promise.resolve(1);
// Add enhancement support for the console.
console_1.enhanceConsole();
async function main() {
    try {
        const args = console_1.cli
            .app("dotnet-install")
            .title("DotNet Framework Installation Utility")
            .copyright("(C) 2017 **Microsoft Corporation.**")
            .command('info', '**Show installed information**', {
            path: pathOption
        }, (args) => exitCode = info(args))
            .command('list', "**Show available dotnet framework versions**", {
            os: osOption,
            arch: archOption,
        }, (args) => exitCode = list(args))
            .command('install', "**Install dotnet framework version**", {
            version: {
                alias: 'v',
                type: 'string',
                describe: 'selected version of dotnet framework to install',
                choices: dotnet.getAllReleasesAndVersions(),
                default: dotnet.getVersions()[0]
            },
            path: pathOption,
            os: osOption,
            arch: archOption
        }, (args) => exitCode = install(args))
            .command('remove', "**Remove installed dotnet framework version**", {
            version: {
                alias: 'v',
                type: 'string',
                describe: 'selected version of dotnet framework to remove',
                choices: [...dotnet.getAllReleases(), ""],
                default: ""
            },
            path: pathOption,
            all: {
                alias: 'a',
                type: 'boolean',
                describe: 'remove all instances of the dotnet framework from the installation folder'
            }
        }, (args) => exitCode = remove(args))
            .showHelpOnFail(true)
            .demandCommand(1)
            .argv;
        process.exit(await exitCode);
    }
    catch (E) {
        console.log(E);
        process.exit(10);
    }
}
main();
async function list(args) {
    console.log("# Available dotnet frameworks ");
    console.log("");
    let table = `|Version|Releases|OperatingSystem|Architectures|\n|--------|-------|-------|--------------|\n`;
    let content = '';
    const arch = args.arch || os.arch();
    for (const version of dotnet.getVersions()) {
        const operatingSystem = args.os || dotnet.detectOperatingSystem(version);
        if (dotnet.isOperatingSystem(version, operatingSystem)) {
            content += `|${version}|${dotnet.getReleases(version)}|${operatingSystem}|${dotnet.getArchitectures(version, operatingSystem)}|\n`;
        }
    }
    if (!content) {
        console.error(`Unable to find dotnet frameworks for ${args.os || dotnet.detectOperatingSystem('2.0')}/${arch}`);
        return 1;
    }
    console.log(table + content);
    console.log("");
    console.log("** ** When specifying a **--version**, you can use a version like **--version=1.1** or a specific release like **--version=1.1.2**");
    return 0;
}
;
async function info(args) {
    console.log("# Installed frameworks ");
    console.log(`> Install folder: ${args.path} `);
    const releases = await dotnet.listInstalledFrameworkRevisions(args.path);
    if (!releases.length) {
        console.log(`> No dotnet frameworks installed in folder: ${args.path} `);
        return 1;
    }
    let table = `|Release|Full Path|\n|--------|------|\n`;
    let content = '';
    for (const release of releases) {
        content += `|${release}|${await dotnet.getFrameworkFolder(args.path, release)}|\n`;
    }
    console.log(table + content);
    return 0;
}
async function install(args) {
    console.log(`# Installing framework`);
    console.log(`> Selected Framework: ${args.os}-${args.version}-${args.arch}`);
    console.log(`> Installation folder: ${printablePath(args.path)} `);
    const progress = dotnet.installFramework(args.version, args.os, args.arch, args.path);
    progress.Start.Subscribe((p, done) => {
        process.stdout.write(`\n  Downloading/Unpacking [-`);
    });
    progress.Progress.Subscribe((p, percent) => {
        process.stdout.write(`-`);
    });
    progress.End.Subscribe((p, done) => {
        process.stdout.write(`-] Done. \n`);
    });
    return await progress ? 0 : 1;
}
async function remove(args) {
    if (!args.all && !args.version) {
        console.error("remove requires either a **--version=...** or **--all**");
        return 1;
    }
    if (args.all) {
        // remove them all.
        const releases = await dotnet.listInstalledFrameworkRevisions(args.path);
        if (!releases.length) {
            console.error(`no frameworks installed in ${printablePath(args.path)}`);
            return 1;
        }
        console.log("# Removing frameworks ");
        console.log(`> Install folder: ${printablePath(args.path)} `);
        await dotnet.removeAllFrameworks(args.path);
        for (const release of releases) {
            console.log(`> Removed dotnet framework '${release}'`);
        }
    }
    else {
        console.log("# Removing frameworks ");
        console.log(`> Install folder: ${printablePath(args.path)} `);
        await dotnet.removeInstalledFramework(args.path, args.version);
    }
    return 0;
}
//# sourceMappingURL=app.js.map