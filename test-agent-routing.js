/**
 * 에이전트 라우팅 기능 테스트 (빌드된 파일 사용)
 */

const { routeToAgent } = require('./backend/api/dist/agents/index');

console.log('='.repeat(50));
console.log('에이전트 라우팅 지능화 테스트');
console.log('='.repeat(50));

const testCases = [
    { query: "웹사이트 만들어줘", expected: "개발 관련" },
    { query: "투자 조언해줘", expected: "금융 관련" },
    { query: "계약서 검토해줘", expected: "법률 관련" },
    { query: "마케팅 전략 세워줘", expected: "비즈니스 관련" },
    { query: "머신러닝 모델 학습시켜줘", expected: "AI/데이터 관련" },
    { query: "두통이 심해요", expected: "의료 관련" }
];

async function runTests() {
    console.log('\n🧪 테스트 시작...\n');

    for (const tc of testCases) {
        console.log(`\n📝 질문: "${tc.query}"`);
        console.log(`   예상: ${tc.expected}`);

        try {
            const result = await routeToAgent(tc.query, true);
            console.log(`   ✅ 결과: ${result.primaryAgent} (${result.category})`);
            console.log(`      이유: ${result.reason}`);
            console.log(`      신뢰도: ${result.confidence}`);
        } catch (e) {
            console.log(`   ❌ 오류: ${e.message}`);
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('테스트 완료');
    console.log('='.repeat(50));
}

runTests().catch(console.error);
