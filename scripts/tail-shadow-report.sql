-- Tail 라우팅 셰도우 관측 리포트 (Q1~Q4) — 2026-07-10-tail-routing.md §6 정의 준수.
-- 재사용: docker exec -i openmake-postgres psql -U openmake -d openmake_llm < scripts/tail-shadow-report.sql
-- 라벨 컬럼(a_was_correct 등)이 채워지기 전엔 Q4/Q3-FP는 비어 있음(오프라인 라벨링 배치 이후 유효).

\echo '===== Q0 표본 규모 · 라벨 커버리지 (승격 판단 전제) ====='
SELECT count(*)                                             AS total_rows,
       min(created_at)::date                               AS first_day,
       max(created_at)::date                               AS last_day,
       count(*) FILTER (WHERE a_was_correct IS NOT NULL)   AS labeled_rows,
       CASE WHEN count(*) >= 100 THEN 'OK(≥100)' ELSE 'INSUFFICIENT(<100)' END AS sample_gate
FROM routing_shadow_decisions;

\echo ''
\echo '===== Q1 tail 비율 (목표 5~15%) ====='
SELECT round(count(*) FILTER (WHERE is_tail)*100.0/NULLIF(count(*),0),1) AS tail_pct,
       count(*) FILTER (WHERE is_tail) AS tail_n,
       count(*)                        AS total_n
FROM routing_shadow_decisions;

\echo ''
\echo '===== Q2 verifiability 분포 (축 B) ====='
SELECT verifiability,
       count(*)                                          AS n,
       round(avg(error_score)::numeric,3)                AS avg_err,
       count(*) FILTER (WHERE is_tail)                   AS routed_tail
FROM routing_shadow_decisions
GROUP BY verifiability ORDER BY count(*) DESC;

\echo ''
\echo '===== Q3 피처 발동 빈도 (라벨 전 — 어떤 error_signal 이 자주 켜지나) ====='
SELECT sig, count(*) AS fired_n,
       round(count(*)*100.0/NULLIF((SELECT count(*) FROM routing_shadow_decisions),0),1) AS fired_pct
FROM routing_shadow_decisions, jsonb_array_elements_text(error_signals) sig
GROUP BY sig ORDER BY count(*) DESC;

\echo ''
\echo '===== Q4 피처별 실패상관 (라벨 결합 후 — 가중치 근거, count≥10) ====='
SELECT sig, count(*) AS n,
       round(avg((NOT a_was_correct)::int)::numeric,3) AS fail_rate
FROM routing_shadow_decisions, jsonb_array_elements_text(error_signals) sig
WHERE a_was_correct IS NOT NULL
GROUP BY sig HAVING count(*) >= 10 ORDER BY fail_rate DESC;
