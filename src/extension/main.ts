/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Hack NPM's output to shut the front door.
require('npm/lib/utils/output');
require.cache[require.resolve('npm/lib/utils/output')].exports = () => { };

import { config, load, commands } from 'npm'
import * as hgi from 'hosted-git-info'
import * as childProcess from 'child_process'
import * as asyncIO from '@microsoft.azure/async-io'
import { Exception, shallowCopy } from '@microsoft.azure/polyfill'
import * as npa from 'npm-package-arg'
import * as u from 'util';
import * as os from 'os';
import * as semver from 'semver';
import { Progress, Subscribe } from '@microsoft.azure/eventing'

import * as path from 'path';
import * as fetch from "npm/lib/fetch-package-metadata";
import * as npmlog from 'npm/node_modules/npmlog'

const npmview = require('npm/lib/view')
const MemoryStream = require('memorystream')

type Config = typeof config;

const npm_config = new Promise<Config>((r, j) => {
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

  load({
    loglevel: 'silent',
    logstream: new MemoryStream(''),

    registry: "https://registry.npmjs.org/"
  }, (e, c) => {
    // console.log("back from load : " + c)
    r(c);
  });
});

export class UnresolvedPackageException extends Exception {
  constructor(packageId: string) {
    super(`Unable to resolve package '${packageId}'.`, 1);
    Object.setPrototypeOf(this, UnresolvedPackageException.prototype);
  }
}

export class InvalidPackageIdentityException extends Exception {
  constructor(name: string, version: string, message: string) {
    super(`Package '${name}' - '${version}' is not a valid package reference:\n  ${message}`, 1);
    Object.setPrototypeOf(this, InvalidPackageIdentityException.prototype);
  }
}

export class PackageInstallationException extends Exception {
  constructor(name: string, version: string, message: string) {
    super(`Package '${name}' - '${version}' failed to install:\n  ${message}`, 1);
    Object.setPrototypeOf(this, PackageInstallationException.prototype);
  }
}
export class UnsatisfiedEngineException extends Exception {
  constructor(name: string, version: string, message: string = "") {
    super(`Unable to find matching engine '${name}' - '${version} ${message}'`, 1);
    Object.setPrototypeOf(this, UnsatisfiedEngineException.prototype);
  }
}

export class MissingStartCommandException extends Exception {
  constructor(extension: Extension) {
    super(`Extension '${extension.id}' is missing the script 'start' in the package.json file`, 1);
    Object.setPrototypeOf(this, MissingStartCommandException.prototype);
  }
}

export class ExtensionFolderLocked extends Exception {
  constructor(path: string) {
    super(`Extension Folder '${path}' is locked by another process.`, 1);
    Object.setPrototypeOf(this, ExtensionFolderLocked.prototype);
  }
}


function cmdlineToArray(text: string, result: Array<string> = [], matcher = /[^\s']+|'([^']*)'/gi, count = 0): Array<string> {
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
    })
    return PATH;
  }
  return "PATH";
}

/**
 * A Package is a representation of a npm package.
 * 
 * Once installed, a Package is an Extension
 */
export class Package {
  /* @internal */ public constructor(/* @internal */ public resolvedInfo: any, /* @internal */ public packageMetadata: any,/* @internal */ public extensionManager: ExtensionManager) {

  }

  get id(): string {
    return this.packageMetadata._id;
  }

  get name(): string {
    return this.packageMetadata.name;
  }

  get version(): string {
    return this.packageMetadata.version;
  }

  get source(): string {
    // work around bug that npm doesn't programatically handle exact versions.
    if (this.resolvedInfo.type == "version" && this.resolvedInfo.registry == true) {
      return this.packageMetadata._spec + "*";
    }
    return this.packageMetadata._spec;
  }

  async install(force: boolean = false): Promise<Extension> {
    return this.extensionManager.installPackage(this, force);
  }

  get allVersions(): Promise<Array<string>> {
    return this.extensionManager.getPackageVersions(this.name);
  }
}

/** 
 * Extension is an installed Package 
 * @extends Package
 * */
export class Extension extends Package {
  /* @internal */ public constructor(pkg: Package, private installationPath: string) {
    super(pkg.resolvedInfo, pkg.packageMetadata, pkg.extensionManager);
  }
  /**
   * The installed location of the package. 
   */
  public get location(): string {
    return path.normalize(`${this.installationPath}/${this.id.replace('/', '_')}`);
  }
  /**
   * The path to the installed npm package (internal to 'location')
   */
  public get modulePath(): string {
    return path.normalize(`${this.location}/node_modules/${this.name}`);
  }

  /**
   * the path to the package.json file for the npm packge.
   */
  public get packageJsonPath(): string {
    return path.normalize(`${this.modulePath}/package.json`);
  }

  /**
 * the path to the readme.md configuration file for the extension.
 */
  public get configurationPath(): Promise<string> {
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
  public get definition(): any {
    return require(this.packageJsonPath);
  }

  public get configuration(): Promise<string> {
    return (async () => {
      const cfgPath = await this.configurationPath;
      if (cfgPath) {
        return await asyncIO.readFile(cfgPath);
      }
      return '';
    })();
  }

  async remove(): Promise<void> {
    return this.extensionManager.removeExtension(this);
  }

  async start(): Promise<childProcess.ChildProcess> {
    return this.extensionManager.start(this);
  }
}

/** 
 * LocalExtension is a local extension that must not be installed.
 * @extends Extension
 * */
export class LocalExtension extends Extension {
  public constructor(pkg: Package, private extensionPath: string) {
    super(pkg, "");
  }
  public get location(): string {
    return this.extensionPath;
  }
  public get modulePath(): string {
    return this.extensionPath;
  }

  async remove(): Promise<void> {
    throw new Error("Cannot remove local extension. Lifetime not our responsibility.");
  }
}

function npmInstall(name: string, version: string, packageSpec: string, force: boolean): Promise<Array<string>> {

  return new Promise((r, j) => {
    try {
      commands.install([packageSpec], (err, r1, r2, r3, r4) => {
        return err ? j(new PackageInstallationException(name, version, err.message)) : r([r1, r2, r3, r4])
      });
    } catch (e) {
    }
  });
}


function npmView(name: string): Promise<Array<any>> {
  return new Promise((r, j) => {
    npmview([`${name}@*`, "version"], true, (err, r1, r2, r3, r4) => {
      return err ? j(new Exception(name)) : r(r1)
    })
  });
}

function fetchPackageMetadata(spec: string, where: string, opts: any): Promise<any> {
  return new Promise<any>((r, j) => {
    fetch(spec, where, opts, (er, pkg) => {
      if (er) {
        return j(new UnresolvedPackageException(spec));
      }
      return r(pkg);
    })
  });
}

function resolveName(name: string, version: string) {
  try {
    return npa.resolve(name, version);
  } catch (e) {
    if (e instanceof Error) {
      throw new InvalidPackageIdentityException(name, version, e.message);
    }
  }
}


export class ExtensionManager {
  private static instances: Array<ExtensionManager> = [];

  public dotnetPath = path.normalize(`${os.homedir()}/.dotnet`);

  public static async Create(installationPath: string): Promise<ExtensionManager> {
    if (!await asyncIO.exists(installationPath)) {
      await asyncIO.mkdir(installationPath);
    }
    if (!await asyncIO.isDirectory(installationPath)) {
      throw new Exception(`Extension folder '${installationPath}' is not a valid directory`);
    }

    return new ExtensionManager(installationPath, await asyncIO.Lock.read(installationPath));
  }
  /*@internal*/ public static async disposeAll() {
    for (const each of this.instances) {
      each.dispose();
    }
  }

  public async dispose() {
    const r = this.readLockRelease;
    this.readLockRelease = async () => { };
    await r();
  }

  public async reset() {
    // release the read lock on the folder
    await this.readLockRelease();

    // check if we can even get a lock
    if (await asyncIO.Lock.check(this.installationPath)) {
      // it's locked. can't reset.
      throw new ExtensionFolderLocked(this.installationPath);
    }

    try {
      // get the exclusive lock
      const release = await asyncIO.Lock.exclusive(this.installationPath);

      // nuke the folder 
      await asyncIO.rmdir(this.installationPath);

      // recreate the folder
      await asyncIO.mkdir(this.installationPath);

      // drop the lock
      release();
    } catch (e) {
      throw (e);
    } finally {
      // add a read lock
      this.readLockRelease = await asyncIO.Lock.read(this.installationPath)
    }

  }

  private constructor(private installationPath: string, private readLockRelease: () => void) {

  }

  public async getPackageVersions(name: string): Promise<string[]> {
    const cc = <any>await npm_config;
    return Object.getOwnPropertyNames(await npmView(name))
  }

  public async findPackage(name: string, version: string = "latest"): Promise<Package> {
    // version can be a version or any one of the formats that 
    // npm accepts (path, targz, git repo)
    await npm_config;

    const resolved = resolveName(name, version);
    // get the package metadata
    const pm = await fetchPackageMetadata(resolved.raw, process.cwd(), {});
    return new Package(resolved, pm, this);
  }

  public async getInstalledExtension(name: string, version: string): Promise<Extension | null> {
    if (!semver.validRange(version)) {
      // if they asked for something that isn't a valid range, we have to find out what version 
      // the target package actually is.
      const pkg = await this.findPackage(name, version);
      version = pkg.version;
    }

    const installed = await this.getInstalledExtensions();
    for (const each of installed) {
      if (name == each.name && semver.satisfies(each.version, version)) {
        return each;
      }
    }
    return null;
  }

  public async getInstalledExtensions(): Promise<Array<Extension>> {
    await npm_config;
    const results = new Array<Extension>();

    // iterate thru the folders. 
    // the folder name should have the pattern @ORG#NAME@VER or NAME@VER 
    for (const folder of await asyncIO.readdir(this.installationPath)) {
      const fullpath = path.join(this.installationPath, folder);
      if (await asyncIO.isDirectory(fullpath)) {

        const split = /((@.+)_)?(.+)@(.+)/.exec(folder);
        if (split) {
          try {
            const org = split[2];
            const name = split[3];
            const version = split[4];

            const actualPath = org ? path.normalize(`${fullpath}/node_modules/${org}/${name}`) : path.normalize(`${fullpath}/node_modules/${name}`)
            const pm = await fetchPackageMetadata(actualPath, actualPath, {});
            const ext = new Extension(new Package(null, pm, this), this.installationPath);
            if (fullpath !== ext.location) {
              console.trace(`WARNING: Not reporting '${fullpath}' since its package.json claims it should be at '${ext.location}' (probably symlinked once and modified later)`);
              continue;
            }
            results.push(ext);
          } catch (e) {
            // ignore things that don't look right.
          }
        }
      }
    }

    // each folder will contain a node_modules folder, which should have a folder by
    // in the node_modules folder there should be a folder by the name of the 
    return results;
  }

  public async installPackage(pkg: Package, force?: boolean, maxWait: number = 5 * 60 * 1000, progressInit: Subscribe = () => { }): Promise<Extension> {
    const progress = new Progress(progressInit);

    const cc = <any>await npm_config;
    const extension = new Extension(pkg, this.installationPath);

    if (!asyncIO.exists(this.installationPath)) {
      await asyncIO.mkdir(this.installationPath);
    }

    // change directory
    const cwd = process.cwd();
    process.chdir(this.installationPath);

    progress.Start.Dispatch(null);

    progress.Progress.Dispatch(25);
    progress.Message.Dispatch("[FYI- npm does not currently support progress... this may take a few moments]");
    let release: asyncIO.release | null = null;

    try {
      // set the prefix to the target location
      cc.localPrefix = extension.location;
      cc.globalPrefix = extension.location;
      cc.prefix = extension.location;
      cc.force = force;

      if (await asyncIO.isDirectory(extension.location)) {
        release = await asyncIO.Lock.waitForExclusive(extension.location);

        if (!force) {
          // already installed
          // if the target folder is created, we're going to make the naive assumption that the package is installed. (--force will blow away)
          return extension;
        }

        // force removal first
        try {

          await asyncIO.rmdir(extension.location);
        }
        catch (e) {
          // no worries.
        }
      }

      // create the folder
      await asyncIO.mkdir(extension.location);

      // acquire the write lock if we don't have it already
      release = release || await asyncIO.Lock.waitForExclusive(extension.location);

      if (release) {
        // run NPM INSTALL for the package.
        progress.NotifyMessage(`Running  npm install for ${pkg.name}, ${pkg.version}`);

        const results = await npmInstall(pkg.name, pkg.version, extension.source, force || false);
        progress.NotifyMessage(`npm install completed ${pkg.name}, ${pkg.version}`);
      } else {
        throw new Exception("NO LOCK.")
      }
      return extension;
    } catch (e) {
      // clean up the attempted install directory
      if (await asyncIO.isDirectory(extension.location)) {
        await asyncIO.rmdir(extension.location);
      }

      if (e instanceof Exception) {
        throw e
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
      if (release) {
        await release();
      }
    }
  }

  public async removeExtension(extension: Extension): Promise<void> {
    if (await asyncIO.isDirectory(extension.location)) {
      const release = await asyncIO.Lock.waitForExclusive(extension.location);
      if (release) {
        await asyncIO.rmdir(extension.location);
        await release();
      } else {
        throw new Exception("I has a sad.");
      }

    }
  }

  public async start(extension: Extension): Promise<childProcess.ChildProcess> {
    // look at the extension for the 
    if (!extension.definition.scripts || !extension.definition.scripts.start) {
      throw new MissingStartCommandException(extension);
    }
    const command = cmdlineToArray(extension.definition.scripts.start);
    if (command.length == 0) {
      throw new MissingStartCommandException(extension);
    }
    // add each engine into the front of the path.
    let env = shallowCopy(process.env);

    // add potential .bin folders (depends on platform and npm version)
    env[getPathVariableName()] = `${path.join(extension.modulePath, "node_modules", ".bin")}${path.delimiter}${env[getPathVariableName()]}`;
    env[getPathVariableName()] = `${path.join(extension.location, "node_modules", ".bin")}${path.delimiter}${env[getPathVariableName()]}`;

    if (command[0] == 'node') {
      // nodejs or electron. Use child_process.fork()
      return childProcess.fork(command[1], command.slice(2), { env: env, cwd: extension.modulePath, silent: true })
    }
    // spawn the command 
    return childProcess.exec(extension.definition.scripts.start, { env: env, cwd: extension.modulePath, maxBuffer: 64 * 1024 * 1024 });
  }
}

// Try to ensure that everything is cleaned up at the end of this process.
process
  .once('SIGINT', () => process.exit(1))
  .once('SIGTERM', () => process.exit(1))
  .once('exit', ExtensionManager.disposeAll);