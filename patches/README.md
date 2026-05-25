# Local SHARP patches

This folder contains patches for the upstream Apple `ml-sharp` repository.

The main project keeps `ml-sharp` as an upstream dependency/submodule instead of
vendoring Apple model weights or rewriting Apple's repository history.

Apply patches from the project root after cloning `ml-sharp`:

```powershell
git -C ml-sharp apply ..\patches\ml-sharp-stereo-render.patch
```

