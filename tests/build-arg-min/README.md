# build-arg minimal test

## 1) Use Dockerfile default ARG

```bash
node udocker.js build -t testarg:default -y tests/build-arg-min
```

Expected `RUN` output contains:

```text
MYARG=default_value
```

## 2) Override ARG from CLI

```bash
node udocker.js build -t testarg:override --build-arg MYARG=from_cli -y tests/build-arg-min
```

Expected `RUN` output contains:

```text
MYARG=from_cli
```

## 3) Interactive mode (default)

If you omit `-y/-n`, mode is interactive (`i`) and each step asks for confirmation.

```bash
node udocker.js build -t testarg:interactive -f Dockerfile tests/build-arg-min
```
