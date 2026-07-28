/**
 * 아티팩트 실행 가능성 판정 회귀 테스트 (@openmake/config).
 *
 * 프론트·백엔드 공통 모듈이지만 apps/web 에는 테스트 러너가 없어 여기(apps/api jest roots)에 둔다.
 *
 * 배경(2026-07-29): "장고 hello world 소스 보여줘" 요청에서 코드는 정상 생성됐는데,
 * 실행 버튼을 누르면 `ModuleNotFoundError: No module named 'django'` 만 나왔다.
 * 샌드박스는 --network none 이라 외부 패키지를 설치할 수 없고 표준 라이브러리만 있는데,
 * 버튼 노출은 언어만 보고 결정하고 있었다. import 정적 분석으로 미리 거른다.
 */
import { checkRunnable } from "@openmake/config";

describe("checkRunnable — 실행 가능", () => {
  it("import 없는 순수 코드", () => {
    expect(checkRunnable("python", 'print("hello world")')).toEqual({ runnable: true });
    expect(checkRunnable("js", 'console.log("hi")')).toEqual({ runnable: true });
  });

  it("표준 라이브러리만 쓰는 코드", () => {
    const py = "import json, math\nfrom collections import Counter\nprint(json.dumps({}))";
    expect(checkRunnable("python", py)).toEqual({ runnable: true });
    const js = 'const fs = require("fs");\nconst path = require("path");';
    expect(checkRunnable("js", js)).toEqual({ runnable: true });
  });

  it("node: 접두사와 슬래시 하위 경로를 내장으로 인식", () => {
    expect(checkRunnable("js", 'import fs from "node:fs/promises";')).toEqual({ runnable: true });
    expect(checkRunnable("js", 'const t = require("timers/promises");')).toEqual({ runnable: true });
  });

  it("상대경로 import 는 외부 의존이 아니다", () => {
    expect(checkRunnable("python", "from . import helper\nimport json")).toEqual({ runnable: true });
    expect(checkRunnable("js", 'import x from "./local.js";')).toEqual({ runnable: true });
  });

  it("언어 표기 흔들림을 흡수한다", () => {
    for (const l of ["python", "py", "Python3", " JS ", "node", "nodejs"]) {
      expect(checkRunnable(l, "")).toEqual({ runnable: true });
    }
  });
});

describe("checkRunnable — 외부 패키지 차단", () => {
  it("django 는 차단하고 패키지명을 알려준다 (실제 사고 재현)", () => {
    const code = 'from django.http import HttpResponse\ndef index(r): return HttpResponse("Hello World!")';
    expect(checkRunnable("python", code)).toEqual({
      runnable: false,
      reason: "external-deps",
      packages: ["django"],
    });
  });

  it("서브모듈 import 도 최상위 패키지로 집계", () => {
    const code = "import numpy.linalg\nfrom pandas.io import json as pj";
    const v = checkRunnable("python", code);
    expect(v).toMatchObject({ runnable: false, reason: "external-deps" });
    expect((v as { packages: string[] }).packages).toEqual(["numpy", "pandas"]);
  });

  it("표준 + 외부가 섞이면 외부만 보고한다", () => {
    const code = "import os\nimport requests\nimport json";
    expect(checkRunnable("python", code)).toEqual({
      runnable: false,
      reason: "external-deps",
      packages: ["requests"],
    });
  });

  it("js require/import 양쪽 형태를 잡는다", () => {
    expect(checkRunnable("js", 'const e = require("express");')).toMatchObject({
      reason: "external-deps",
      packages: ["express"],
    });
    expect(checkRunnable("js", 'import axios from "axios";')).toMatchObject({
      reason: "external-deps",
      packages: ["axios"],
    });
  });
});

describe("checkRunnable — 미지원 언어", () => {
  it("실행 대상이 아닌 언어는 unsupported-language", () => {
    for (const l of ["markdown", "html", "sql", "", null, undefined]) {
      expect(checkRunnable(l, "anything")).toEqual({
        runnable: false,
        reason: "unsupported-language",
      });
    }
  });
});
