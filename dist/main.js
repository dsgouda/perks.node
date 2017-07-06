"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const polyfill = require("@microsoft.azure/polyfill");
const os = require("os");
const fs = require("fs");
const exception_1 = require("./exception");
const req = require("request");
const unpack_1 = require("@microsoft.azure/unpack");
const eventing_1 = require("@microsoft.azure/eventing");
const async_io_1 = require("@microsoft.azure/async-io");
const path = require("path");
var eventing_2 = require("@microsoft.azure/eventing");
exports.ProgressPromise = eventing_2.ProgressPromise;
var progress = require('request-progress');
// ensure that we're polyfilled.
polyfill.polyfilled;
// load framework definitions
const frameworks = require("../frameworks.json");
function contains(item, collection) {
    for (const each in collection) {
        if (each == item) {
            return true;
        }
    }
    return false;
}
function getVersions() {
    return Object.getOwnPropertyNames(frameworks);
}
exports.getVersions = getVersions;
function isVersion(version) {
    return getVersions().indexOf(version) > -1;
}
exports.isVersion = isVersion;
function isOperatingSystem(version, operatingSystem) {
    return getOperatingSystems(version).indexOf(operatingSystem) > -1;
}
exports.isOperatingSystem = isOperatingSystem;
function getVersionFromRelease(release) {
    for (const version of getVersions()) {
        if (frameworks[version].releases.indexOf(release) > -1) {
            return version;
        }
    }
    return "";
}
function getReleaseFromVersion(version) {
    if (isVersion(version)) {
        return getReleases(version)[0];
    }
    return version;
}
exports.getReleaseFromVersion = getReleaseFromVersion;
function isArchitecture(version, operatingSystem, architecture) {
    getVersionFromRelease(version);
    if (isOperatingSystem(version, operatingSystem)) {
        // using version
        if (frameworks[version].operatingSystems[operatingSystem].indexOf(architecture) > -1) {
            return true;
        }
    }
    const vv = getVersionFromRelease(version);
    if (vv) {
        return isOperatingSystem(vv, operatingSystem);
    }
    return false;
}
exports.isArchitecture = isArchitecture;
function getReleases(version) {
    if (isVersion(version)) {
        return frameworks[version].releases;
    }
    return [];
}
exports.getReleases = getReleases;
function getAllOperatingSystems() {
    const result = [];
    for (const v of getVersions()) {
        for (const o of getOperatingSystems(v)) {
            if (result.indexOf(o) == -1) {
                result.push(o);
            }
        }
    }
    return result;
}
exports.getAllOperatingSystems = getAllOperatingSystems;
function getOperatingSystems(version) {
    if (isVersion(version)) {
        return Object.getOwnPropertyNames(frameworks[version].operatingSystems);
    }
    return [];
}
exports.getOperatingSystems = getOperatingSystems;
function getAllArchitectures() {
    const result = [];
    for (const v of getVersions()) {
        for (const o of getOperatingSystems(v)) {
            for (const a of getArchitectures(v, o)) {
                if (result.indexOf(a) == -1) {
                    result.push(a);
                }
            }
        }
    }
    return result;
}
exports.getAllArchitectures = getAllArchitectures;
function getArchitectures(version, operatingSystem) {
    if (isOperatingSystem(version, operatingSystem)) {
        return frameworks[version].operatingSystems[operatingSystem];
    }
    return [];
}
exports.getArchitectures = getArchitectures;
function getDownloadUrl(version, operatingSystem, architecture) {
    if (isArchitecture(version, operatingSystem, architecture)) {
        return `https://aka.ms/dotnet/${version}/${operatingSystem}/${architecture}`;
    }
    throw new exception_1.UnknownFramework(`${version}/${operatingSystem}/${architecture}`);
}
exports.getDownloadUrl = getDownloadUrl;
async function isInstalled(version, folder = path.normalize(`${os.homedir()}/.dotnet`)) {
    return (await listInstalledFrameworkRevisions(folder)).indexOf(version) > -1;
}
exports.isInstalled = isInstalled;
function installFramework(version, operatingSystem, architecture, folder = path.normalize(`${os.homedir()}/.dotnet`), force = false) {
    version = getReleaseFromVersion(version);
    const URL = getDownloadUrl(version, operatingSystem, architecture);
    let rq = progress(req(URL), { delay: 500, throttle: 500 });
    const result = new eventing_1.ProgressPromise(isInstalled(version, folder).then(async (i) => {
        if (force || !i) {
            await unpack_1.unpack(rq, folder);
        }
    }));
    rq.on("progress", (state) => {
        result.SetProgress(Math.round(state.percent * 100));
    });
    rq.on('end', function () {
        result.SetEnd();
    });
    return result;
}
exports.installFramework = installFramework;
function getAllReleasesAndVersions() {
    const result = getVersions();
    for (const v of getVersions()) {
        for (const r of getReleases(v)) {
            if (result.indexOf(r) == -1) {
                result.push(r);
            }
        }
    }
    return result;
}
exports.getAllReleasesAndVersions = getAllReleasesAndVersions;
function getAllReleases() {
    const result = [];
    for (const v of getVersions()) {
        for (const r of getReleases(v)) {
            if (result.indexOf(r) == -1) {
                result.push(r);
            }
        }
    }
    return result;
}
exports.getAllReleases = getAllReleases;
function detectOperatingSystem(version) {
    switch (version) {
        case "2.0":
        case "2.0.0-preview1":
            return detectOperatingSystem20();
        case "1.0":
        case "1.0.5":
        case "1.0.4":
            return detectOperatingSystem10();
        case "1.1":
        case "1.1.2":
            return detectOperatingSystem11();
    }
    throw new exception_1.UnknownFramework(version);
}
exports.detectOperatingSystem = detectOperatingSystem;
function detectOperatingSystem10() {
    switch (os.platform()) {
        case 'darwin':
            return 'osx';
        case 'win32':
            return `windows`;
        case 'linux':
            const text = fs.readFileSync(`/etc/os-release`, { encoding: `utf8` }).replace(`"`, ``);
            const osrelease = {
                id: (/ID=(.*)/.exec(text) || [null, null])[1],
                version: (/ID_VERSION=(.*)/.exec(text) || /VERSION_ID="*([^"]*)"*/.exec(text) || [null, null])[1]
            };
            switch (osrelease.id) {
                case "centos":
                    return `centos`;
                case "debian":
                    return `debian`;
                case "rhel":
                    return `rhel`;
                case "ubuntu":
                    switch (osrelease.version) {
                        case "14.04":
                            return `ubuntu-14.04`;
                        case "16.04":
                            return `ubuntu-16.04`;
                        case "16.10":
                            return `ubuntu-16.04`;
                    }
            }
            throw new exception_1.UnsupportedPlatformException(`${os.platform()}-${osrelease.id}-${osrelease.version}-${os.arch()}`);
    }
    throw new exception_1.UnsupportedPlatformException(`${os.platform()}-${os.arch()}`);
}
function detectOperatingSystem11() {
    switch (os.platform()) {
        case 'darwin':
            return 'osx';
        case 'win32':
            return `windows`;
        case 'linux':
            const text = fs.readFileSync(`/etc/os-release`, { encoding: `utf8` }).replace(`"`, ``);
            const osrelease = {
                id: (/ID=(.*)/.exec(text) || [null, null])[1],
                version: (/ID_VERSION=(.*)/.exec(text) || [null, null])[1]
            };
            switch (osrelease.id) {
                case "centos":
                    return `centos`;
                case "debian":
                    return `debian`;
                case "rhel":
                    return `rhel`;
                case "ubuntu":
                    switch (osrelease.version) {
                        case "14.04":
                            return `ubuntu-14.04`;
                        case "16.04":
                            return `ubuntu-16.04`;
                        case "16.10":
                            return `ubuntu-16.10`;
                    }
                case "fedora":
                    return `fedora`;
                case "opensuse":
                    return `opensuse`;
            }
            throw new exception_1.UnsupportedPlatformException(`${os.platform()}-${osrelease.id}-${osrelease.version}-${os.arch()}`);
    }
    throw new exception_1.UnsupportedPlatformException(`${os.platform()}-${os.arch()}`);
}
function detectOperatingSystem20() {
    switch (os.platform()) {
        case 'darwin':
            return 'osx';
        case 'win32':
            return `windows`;
        case 'linux':
            return `linux`;
    }
    throw new exception_1.UnsupportedPlatformException(`${os.platform()}-${os.arch()}`);
}
async function listInstalledFrameworkRevisions(folder) {
    if (await async_io_1.exists(folder)) {
        const shared = path.join(folder, "shared", "Microsoft.NETCore.App");
        if (await async_io_1.exists(shared)) {
            // yes there is a shared framework folder. 
            const result = [];
            for (const each of await async_io_1.readdir(shared)) {
                // strip build junk off end.
                result.push(each.replace(/(.*?)-(.*?)-.*/g, `$1-$2`));
            }
            return result;
        }
    }
    return [];
}
exports.listInstalledFrameworkRevisions = listInstalledFrameworkRevisions;
async function removeAllFrameworks(folder) {
    if (await async_io_1.exists(folder)) {
        await async_io_1.rmdir(folder);
    }
}
exports.removeAllFrameworks = removeAllFrameworks;
async function removeInstalledFramework(folder, release) {
    if (await async_io_1.exists(folder)) {
        const fw = await getFrameworkFolder(folder, release);
        await async_io_1.rmdir(fw);
        if (!(await listInstalledFrameworkRevisions(folder)).length) {
            // no frameworks left. remove the whole folder
            await async_io_1.rmdir(folder);
        }
    }
}
exports.removeInstalledFramework = removeInstalledFramework;
async function getFrameworkFolder(folder, release) {
    if (await async_io_1.exists(folder)) {
        const shared = path.join(folder, "shared", "Microsoft.NETCore.App");
        if (await async_io_1.exists(shared)) {
            for (const each of await async_io_1.readdir(shared)) {
                // strip build junk off end.
                const fwname = each.replace(/(.*?)-(.*?)-.*/g, `$1-$2`);
                if (fwname == release) {
                    return path.join(shared, each);
                }
            }
        }
    }
    throw new exception_1.FrameworkNotInstalledException(folder, release);
}
exports.getFrameworkFolder = getFrameworkFolder;
//# sourceMappingURL=main.js.map