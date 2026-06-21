class DummyClass {
  use() {}
  turndown() { return ""; }
}

module.exports = {
  __esModule: true,
  default: DummyClass,
  JSDOM: DummyClass,
  Readability: DummyClass,
  gfm: {}
};
