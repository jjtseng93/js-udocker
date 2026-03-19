# Proot modification
- Most of the examples here require a modified version of proot to support auto port add
- You have 2 options to run it
## Run in my App
- https://drive.google.com/file/d/16grnXaAQR9oxKt07m1nG1VAR0aUC2QFY/view?usp=drivesdk
- the examples will be in ~/dockerfiles/
## Run in Termux:
- Compile it here by make -C src:
- https://github.com/termux/proot/issues/339
- you'll get it in src/proot
- and remember to: 
- export PROOT_LOADER=/path/to/loader
  * proot loader in PlayStore version:
  * $HOME/../applib/libproot-loader.so
  * .
  * proot loader in F-Droid:
  * can use the one inside compiled folder:
  * src/loader/loader
- make a symlink to $PREFIX/bin
