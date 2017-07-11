"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
// Hack NPM's output to shut the front door.
require('npm/lib/utils/output');
require.cache[require.resolve('npm/lib/utils/output')].exports = () => { };
const npm_1 = require("npm");
const childProcess = require("child_process");
const asyncIO = require("@microsoft.azure/async-io");
const polyfill_1 = require("@microsoft.azure/polyfill");
const npa = require("npm-package-arg");
const os = require("os");
const dotnet = require("dotnet-install");
const semver = require("semver");
const eventing_1 = require("@microsoft.azure/eventing");
const path = require("path");
const fetch = require("npm/lib/fetch-package-metadata");
const npmlog = require("npm/node_modules/npmlog");
const npmview = require('npm/lib/view');
const MemoryStream = require('memorystream');
const npm_config = new Promise((r, j) => {
    npmlog.stream = { isTTY: false };
    npmlog.disableProgress();
    npmlog.disableColor();
    npmlog.resume = () => { };
    npmlog.level = "silent";
    npmlog.write = () => { };
    npmlog.info = () => { };
    npmlog.notice = () => { };
    npmlog.verbose = () => { };
    npmlog.silent = () => { };
    npmlog.gauge.enable = () => { };
    npmlog.gauge.disable();
    npm_1.load({
        loglevel: 'silent',
        logstream: new MemoryStream(''),
        registry: "https://registry.npmjs.org/"
    }, (e, c) => {
        // console.log("back from load : " + c)
        r(c);
    });
});
class UnresolvedPackageException extends polyfill_1.Exception {
    constructor(packageId) {
        super(`Unable to resolve package '${packageId}'.`, 1);
        Object.setPrototypeOf(this, UnresolvedPackageException.prototype);
    }
}
exports.UnresolvedPackageException = UnresolvedPackageException;
class InvalidPackageIdentityException extends polyfill_1.Exception {
    constructor(name, version, message) {
        super(`Package '${name}' - '${version}' is not a valid package reference:\n  ${message}`, 1);
        Object.setPrototypeOf(this, InvalidPackageIdentityException.prototype);
    }
}
exports.InvalidPackageIdentityException = InvalidPackageIdentityException;
class PackageInstallationException extends polyfill_1.Exception {
    constructor(name, version, message) {
        super(`Package '${name}' - '${version}' failed to install:\n  ${message}`, 1);
        Object.setPrototypeOf(this, PackageInstallationException.prototype);
    }
}
exports.PackageInstallationException = PackageInstallationException;
class UnsatisfiedEngineException extends polyfill_1.Exception {
    constructor(name, version, message = "") {
        super(`Unable to find matching engine '${name}' - '${version} ${message}'`, 1);
        Object.setPrototypeOf(this, UnsatisfiedEngineException.prototype);
    }
}
exports.UnsatisfiedEngineException = UnsatisfiedEngineException;
class MissingStartCommandException extends polyfill_1.Exception {
    constructor(extension) {
        super(`Extension '${extension.id}' is missing the script 'start' in the package.json file`, 1);
        Object.setPrototypeOf(this, MissingStartCommandException.prototype);
    }
}
exports.MissingStartCommandException = MissingStartCommandException;
function cmdlineToArray(text, result = [], matcher = /[^\s']+|'([^']*)'/gi, count = 0) {
    const match = matcher.exec(text);
    return match ? cmdlineToArray(text, result, matcher, result.push(match[1] ? match[1] : match[0])) : result;
}
function getPathVariableName() {
    // windows calls it's path 'Path' usually, but this is not guaranteed.
    if (process.platform === 'win32') {
        let PATH = 'Path';
        Object.keys(process.env).forEach(function (e) {
            if (e.match(/^PATH$/i)) {
                PATH = e;
            }
        });
        return PATH;
    }
    return "PATH";
}
/**
 * A Package is a representation of a npm package.
 *
 * Once installed, a Package is an Extension
 */
class Package {
    /* @internal */ constructor(/* @internal */ resolvedInfo, /* @internal */ packageMetadata, /* @internal */ extensionManager) {
        this.resolvedInfo = resolvedInfo;
        this.packageMetadata = packageMetadata;
        this.extensionManager = extensionManager;
    }
    get id() {
        return this.packageMetadata._id;
    }
    get name() {
        return this.packageMetadata.name;
    }
    get version() {
        return this.packageMetadata.version;
    }
    get source() {
        // work around bug that npm doesn't programatically handle exact versions.
        if (this.resolvedInfo.type == "version" && this.resolvedInfo.registry == true) {
            return this.packageMetadata._spec + "*";
        }
        return this.packageMetadata._spec;
    }
    get engines() {
        return this.packageMetadata.engines;
    }
    async install(force = false) {
        return this.extensionManager.installPackage(this, force);
    }
    get allVersions() {
        return this.extensionManager.getPackageVersions(this.name);
    }
}
exports.Package = Package;
/**
 * Extension is an installed Package
 * @extends Package
 * */
class Extension extends Package {
    /* @internal */ constructor(pkg, installationPath) {
        super(pkg.resolvedInfo, pkg.packageMetadata, pkg.extensionManager);
        this.installationPath = installationPath;
    }
    /**
     * The installed location the package.
     */
    get location() {
        return path.normalize(`${this.installationPath}/${this.id.replace('/', '_')}`);
    }
    /**
     * The path to the installed npm package (internal to 'location')
     */
    get modulePath() {
        return path.normalize(`${this.location}/node_modules/${this.name}`);
    }
    /**
     * the path to the package.json file for the npm packge.
     */
    get packageJsonPath() {
        return path.normalize(`${this.modulePath}/package.json`);
    }
    /**
   * the path to the readme.md configuration file for the extension.
   */
    get configurationPath() {
        return (async () => {
            var items = await asyncIO.readdir(this.modulePath);
            for (const each of items) {
                if (/^readme.md$/i.exec(each)) {
                    const fullPath = path.normalize(`${this.modulePath}/${each}`);
                    if (await asyncIO.isFile(fullPath)) {
                        return fullPath;
                    }
                }
            }
            return "";
        })();
    }
    /** the loaded package.json information */
    get definition() {
        return require(this.packageJsonPath);
    }
    get configuration() {
        return (async () => {
            const cfgPath = await this.configurationPath;
            if (cfgPath) {
                return await asyncIO.readFile(cfgPath);
            }
            return '';
        })();
    }
    async remove() {
        return this.extensionManager.removeExtension(this);
    }
    async start() {
        return this.extensionManager.start(this);
    }
}
exports.Extension = Extension;
function npmInstall(name, version, packageSpec, force) {
    return new Promise((r, j) => {
        try {
            npm_1.commands.install([packageSpec], (err, r1, r2, r3, r4) => {
                return err ? j(new PackageInstallationException(name, version, err.message)) : r([r1, r2, r3, r4]);
            });
        }
        catch (e) {
        }
    });
}
function npmView(name) {
    return new Promise((r, j) => {
        npmview([`${name}@*`, "version"], true, (err, r1, r2, r3, r4) => {
            return err ? j(new polyfill_1.Exception(name)) : r(r1);
        });
    });
}
function fetchPackageMetadata(spec, where, opts) {
    return new Promise((r, j) => {
        fetch(spec, where, opts, (er, pkg) => {
            if (er) {
                return j(new UnresolvedPackageException(spec));
            }
            return r(pkg);
        });
    });
}
function resolveName(name, version) {
    try {
        return npa.resolve(name, version);
    }
    catch (e) {
        if (e instanceof Error) {
            throw new InvalidPackageIdentityException(name, version, e.message);
        }
    }
}
class ExtensionManager {
    constructor(installationPath) {
        this.installationPath = installationPath;
        this.dotnetPath = path.normalize(`${os.homedir()}/.dotnet`);
    }
    static async Create(installationPath) {
        if (!asyncIO.exists(installationPath)) {
            await asyncIO.mkdir(installationPath);
        }
        if (!asyncIO.isDirectory(installationPath)) {
            throw new polyfill_1.Exception(`Extension folder '${installationPath}' is not a valid directory`);
        }
        return new ExtensionManager(installationPath);
    }
    // public async installEngine(name: string, version: string, onStart: () => void = () => { }, onEnd: () => void = () => { }, onProgress: (n:number) => void = (n) => { }, onMessage: (t:string) => void = (t) => { } ): Promise<any> {
    installEngine(name, version, force = false) {
        switch (name) {
            case "dotnet":
                const selectedVersion = semver.maxSatisfying(dotnet.getAllReleases(), version, true);
                if (!selectedVersion) {
                    throw new UnsatisfiedEngineException(name, version);
                }
                const operatingSystem = dotnet.detectOperatingSystem(selectedVersion);
                if (!operatingSystem) {
                    throw new UnsatisfiedEngineException(name, version, ` -- unsupported operating system.`);
                }
                if (!force && dotnet.isInstalled(selectedVersion, this.dotnetPath)) {
                    return new eventing_1.ProgressPromise(Promise.resolve());
                }
                return dotnet.installFramework(selectedVersion, operatingSystem, os.arch(), this.dotnetPath);
            case "node":
            case "npm":
                // no worries with these for now
                return new eventing_1.ProgressPromise(Promise.resolve());
            default:
                throw new UnsatisfiedEngineException(name, version);
        }
    }
    async getPackageVersions(name) {
        const cc = await npm_config;
        return Object.getOwnPropertyNames(await npmView(name));
    }
    async findPackage(name, version = "latest") {
        // version can be a version or any one of the formats that 
        // npm accepts (path, targz, git repo)
        await npm_config;
        const resolved = resolveName(name, version);
        // get the package metadata
        const pm = await fetchPackageMetadata(resolved.raw, process.cwd(), {});
        return new Package(resolved, pm, this);
    }
    async getInstalledExtensions() {
        await npm_config;
        const results = new Array();
        // iterate thru the folders. 
        // the folder name should have the pattern @ORG#NAME@VER or NAME@VER 
        for (const folder of await asyncIO.readdir(this.installationPath)) {
            const fullpath = path.join(this.installationPath, folder);
            if (await asyncIO.isDirectory(fullpath)) {
                const split = /((@.+)#)?(.+)@(.+)/.exec(folder);
                if (split) {
                    try {
                        const org = split[2];
                        const name = split[3];
                        const version = split[4];
                        const actualPath = org ? path.normalize(`${fullpath}/node_modules/${org}/${name}`) : path.normalize(`${fullpath}/node_modules/${name}`);
                        const pm = await fetchPackageMetadata(actualPath, actualPath, {});
                        results.push(new Extension(new Package(null, pm, this), this.installationPath));
                    }
                    catch (e) {
                        // ignore things that don't look right.
                    }
                }
            }
        }
        // each folder will contain a node_modules folder, which should have a folder by
        // in the node_modules folder there should be a folder by the name of the 
        return results;
    }
    installPackage(pkg, force) {
        const p = new eventing_1.ProgressPromise();
        return p.initialize(this._installPackage(pkg, force || false, p));
    }
    async _installPackage(pkg, force, progress) {
        const cc = await npm_config;
        const extension = new Extension(pkg, this.installationPath);
        // change directory
        const cwd = process.cwd();
        try { await asyncIO.mkdir(this.installationPath); } catch (e) { }
        process.chdir(this.installationPath);
        progress.Start.Dispatch(null);
        const engineCount = extension.engines ? Object.getOwnPropertyNames(extension.engines).length : 0;
        if (extension.engines) {
            for (const engine in extension.engines) {
                progress.Message.Dispatch(`Installing ${engine}, ${extension.engines[engine]}`);
                const installing = this.installEngine(engine, extension.engines[engine], force);
                // all engines are 1/4 of the install. 
                // each engine is 1/count of the progress; 
                installing.Progress.Subscribe((src, percent) => progress.Progress.Dispatch((percent / engineCount) / 4));
                await installing;
            }
        }
        progress.Progress.Dispatch(25);
        progress.Message.Dispatch("[FYI- npm does not currently support progress... this may take a few moments]");
        try {
            // set the prefix to the target location
            cc.localPrefix = extension.location;
            cc.globalPrefix = extension.location;
            cc.prefix = extension.location;
            cc.force = force;
            if (await asyncIO.isDirectory(extension.location)) {
                if (force) {
                    try {
                        await asyncIO.rmdir(extension.location);
                    }
                    catch (e) {
                        // no worries.
                    }
                }
                else {
                    // already installed
                    return extension;
                }
            }
            await asyncIO.mkdir(extension.location);
            // run NPM INSTALL for the package.
            progress.Message.Dispatch(`Running  npm install for ${pkg.name}, ${pkg.version}`);
            const results = await npmInstall(pkg.name, pkg.version, extension.source, force);
            progress.Message.Dispatch(`npm install completed ${pkg.name}, ${pkg.version}`);
            return extension;
        }
        catch (e) {
            // clean up the attempted install directory
            if (await asyncIO.isDirectory(extension.location)) {
                await asyncIO.rmdir(extension.location);
            }
            if (e instanceof polyfill_1.Exception) {
                throw e;
            }
            if (e instanceof Error) {
                throw new PackageInstallationException(pkg.name, pkg.version, e.message + e.stack);
            }
            throw new PackageInstallationException(pkg.name, pkg.version, `${e}`);
        }
        finally {
            process.chdir(cwd);
            progress.Progress.Dispatch(100);
            progress.End.Dispatch(null);
        }
    }
    async removeExtension(extension) {
        if (await asyncIO.isDirectory(extension.location)) {
            await asyncIO.rmdir(extension.location);
        }
    }
    async start(extension) {
        // look at the extension for the 
        if (!extension.definition.scripts || !extension.definition.scripts.start) {
            throw new MissingStartCommandException(extension);
        }
        const command = cmdlineToArray(extension.definition.scripts.start);
        if (command.length == 0) {
            throw new MissingStartCommandException(extension);
        }
        // add each engine into the front of the path.
        let env = polyfill_1.shallowCopy(process.env);
        if (extension.engines) {
            for (const engine in extension.engines) {
                switch (engine) {
                    case 'dotnet':
                        // insert dotnet into the path. version not important, since the dotnet executable handles that.
                        env[getPathVariableName()] = `${this.dotnetPath}${path.delimiter}${env[getPathVariableName()]}`;
                        break;
                }
            }
        }
        if (command[0] == 'node') {
            // nodejs or electron. Use child_process.fork()
            return childProcess.fork(command[1], command.slice(2), { env: env, cwd: extension.modulePath, silent: true });
        }
        // spawn the command 
        return childProcess.spawn(command[0], command.slice(1), { env: env, cwd: extension.modulePath });
    }
}
exports.ExtensionManager = ExtensionManager;
//# sourceMappingURL=main.js.map
