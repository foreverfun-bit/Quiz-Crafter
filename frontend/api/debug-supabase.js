const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || null;

    const result = {
      hasSupabaseUrl: !!supabaseUrl,
      hasNextPublicSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasServiceRoleKey: !!serviceKey,
      supabaseUrlValue: supabaseUrl,
    };

    if (!supabaseUrl || !serviceKey) {
      return res.status(200).json({
        ok: false,
        stage: "env_check",
        ...result,
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { error } = await supabase.from("questions").select("id").limit(1);

    return res.status(200).json({
      ok: !error,
      stage: "db_check",
      ...result,
      dbError: error ? error.message : null,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      stage: "crash",
      error: error.message,
    });
  }
};
