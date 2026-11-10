const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pepper = process.env.AUTH_PEPPER;

  const result = {
    configuration: {
      url: Boolean(url),
      key: Boolean(key),
      pepper: Boolean(pepper && pepper.length >= 32)
    },
    tables: {}
  };

  if (url && key) {
    try {
      const db = createClient(url, key, {
        auth: { persistSession: false }
      });

      for (const [table, column] of [
        ['players', 'id'],
        ['rounds', 'id'],
        ['managers', 'id'],
        ['manager_sessions', 'id'],
        ['roster_entries', 'id'],
        ['transfers', 'id'],
        ['manager_round_points', 'round_id']
      ]) {
        const { error } = await db.from(table)
          .select(column).limit(1);

        result.tables[table] = error
          ? { error: error.message, code: error.code }
          : 'OK';
      }
    } catch (e) {
      result.connection = 'Connection failed';
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(result);
};
