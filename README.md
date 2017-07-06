# Project: dotnet-install

This package provides a script for reliably installing the dotnet framework cross-platform.

### Examples

#### Show Help
```
> dotnet-install --help 

DotNet Framework Installation Utility
(C) 2017 Microsoft Corporation.

Usage: dotnet-install <command> [options]

Commands:
  info     Show installed information
  list     Show available dotnet framework versions
  install  Install dotnet framework version
  remove   Remove installed dotnet framework version

Options:
  --help  Show help  [boolean]
```

#### Install
```
> dotnet-install install --version 1.0
Installing framework
  Selected Framework: windows-1.0-x64
  Installation folder: C:\Users\garrett\.dotnet

  Downloading/Unpacking [-----] Done.
```



----

# Contributing

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
