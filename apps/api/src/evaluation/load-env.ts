/**
 * 평가 CLI 용 — 저장소 루트의 .env 를 읽는다. 설정 모듈을 정적으로 import 하는 평가 스크립트는 이 모듈을 **맨 먼저** import 한다
 * (설정 검증이 import 시점에 돌기 때문에, 그 전에 환경이 채워져 있어야 한다). CI 는 전역 env 로 주므로 파일이 없어도 된다.
 *
 * @module evaluation/load-env
 */
import * as path from 'path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });
