const pg = require('/Volumes/MAC_APP/openmake_llm/node_modules/pg');
const { RICH_SKILL_CONTENT } = require('/Volumes/MAC_APP/openmake_llm/backend/api/dist/agents/skill-seeder.js');

const pool = new pg.Pool({
    connectionString: 'postgresql://openmake:openmake_secret_2026@127.0.0.1:5432/openmake_llm',
});

async function run() {
    const ids = Object.keys(RICH_SKILL_CONTENT);
    if (ids.length !== 97) {
        throw new Error(`RICH_SKILL_CONTENT size mismatch: expected 97, got ${ids.length}`);
    }

    let updated = 0;
    let missing = 0;

    for (const [agentId, content] of Object.entries(RICH_SKILL_CONTENT)) {
        const skillId = `system-skill-${agentId}`;
        const result = await pool.query(
            'UPDATE agent_skills SET content = $1, updated_at = NOW() WHERE id = $2',
            [content, skillId]
        );

        if (result.rowCount && result.rowCount > 0) {
            updated += result.rowCount;
        } else {
            missing += 1;
        }
    }

    console.log(`Updated rows: ${updated}`);
    console.log(`Missing rows: ${missing}`);
}

run()
    .catch(err => {
        console.error('Failed to update agent skills:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
