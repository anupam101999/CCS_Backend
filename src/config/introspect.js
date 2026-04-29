const pool = require("../config/db");

async function introspect() {
  try {
    const { rows: tables } = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type   = 'BASE TABLE'
      ORDER BY table_name;
    `);

    if (tables.length === 0) {
      console.log("ℹ️  No tables found in public schema.");
      return;
    }

    console.log(
      `📋 Tables found: ${tables.map((t) => t.table_name).join(", ")}`,
    );

    for (const { table_name } of tables) {
      const { rows: cols } = await pool.query(
        `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = $1
        ORDER BY ordinal_position;
      `,
        [table_name],
      );

      const summary = cols
        .map(
          (c) =>
            `${c.column_name} (${c.data_type}${c.is_nullable === "NO" ? ", NOT NULL" : ""})`,
        )
        .join(" | ");

      console.log(`  └─ ${table_name}: ${summary}`);
    }
  } catch (err) {
    console.error("❌ DB introspection error:", err.message);
  }
}

module.exports = introspect;
