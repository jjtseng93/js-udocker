class Msg {
  static NIL = -1;
  static ERR = 0;
  static MSG = 1;
  static WAR = 2;
  static INF = 3;
  static VER = 4;
  static DBG = 5;

  static level = Msg.INF;

  static out(...args) {
    const last = args[args.length - 1];
    const level = last && typeof last === "object" && last.l !== undefined ? last.l : Msg.MSG;
    if (level <= Msg.level) {
      const parts = level === last?.l ? args.slice(0, -1) : args;
      process.stdout.write(parts.map(String).join(" ") + "\n");
    }
  }

  static err(...args) {
    const last = args[args.length - 1];
    const level = last && typeof last === "object" && last.l !== undefined ? last.l : Msg.ERR;
    if (level <= Msg.level) {
      const parts = level === last?.l ? args.slice(0, -1) : args;
      process.stderr.write(parts.map(String).join(" ") + "\n");
    }
  }
}

module.exports = { Msg };
