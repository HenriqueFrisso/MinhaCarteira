
import { createClient } from "npm:@supabase/supabase-js@2";

const BRAPI_URL = "https://brapi.dev/api/quote";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  const cronSecret = Deno.env.get("CRON_SECRET");
  const receivedSecret = req.headers.get("x-cron-secret");

  if (!cronSecret || receivedSecret !== cronSecret) {
    return jsonResponse({ error: "Não autorizado." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const brapiToken = Deno.env.get("BRAPI_TOKEN");

  if (!supabaseUrl || !serviceRoleKey || !brapiToken) {
    return jsonResponse({
      error: "Configuração incompleta dos segredos.",
    }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: ativos, error: ativosError } = await supabase
    .from("ativos")
    .select("id, ticker, classe")
    .not("ticker", "is", null)
    .in("classe", ["Ações", "FIIs", "ETFs"]);

  if (ativosError) {
    return jsonResponse({
      error: "Erro ao consultar os ativos.",
      details: ativosError.message,
    }, 500);
  }

  let atualizados = 0;
  let falhas = 0;
  const erros: string[] = [];

  for (const ativo of ativos ?? []) {
    const ticker = String(ativo.ticker ?? "").trim().toUpperCase();

    if (!ticker) continue;

    try {
      const url = new URL(
        `${BRAPI_URL}/${encodeURIComponent(ticker)}`,
      );
      url.searchParams.set("token", brapiToken);

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Brapi respondeu HTTP ${response.status}`);
      }

      const body = await response.json();
      const quote = (body.results ?? []).find(
        (item: { symbol?: string }) =>
          item.symbol?.toUpperCase() === ticker,
      );

      if (typeof quote?.regularMarketPrice !== "number") {
        throw new Error("Cotação não encontrada.");
      }

      const preco = quote.regularMarketPrice;
      const marketTime = quote.regularMarketTime
        ? new Date(quote.regularMarketTime)
        : new Date();

      const atualizadoEm = new Date().toISOString();
      const dataCotacao = marketTime.toISOString().slice(0, 10);

      // Atualiza a cotação mais recente do ativo.
      const { error: updateError } = await supabase
        .from("ativos")
        .update({
          cotacao_atual: preco,
          data_cotacao: marketTime.toISOString(),
          fonte_cotacao: "brapi",
          atualizado_em: atualizadoEm,
        })
        .eq("id", ativo.id);

      if (updateError) {
        throw new Error(
          `Erro ao atualizar ativo: ${updateError.message}`,
        );
      }

      // Registra o histórico de cotações.
      const { error: historyError } = await supabase
        .from("cotacoes")
        .insert({
          ativo_id: ativo.id,
          preco,
          data_cotacao: dataCotacao,
          atualizado_em: atualizadoEm,
          fonte: "brapi",
        });

      if (historyError) {
        throw new Error(
          `Cotação atualizada, mas o histórico falhou: ${historyError.message}`,
        );
      }

      atualizados++;
    } catch (error) {
      falhas++;

      const message =
        error instanceof Error ? error.message : "Erro desconhecido";

      erros.push(`${ticker}: ${message}`);
      console.error(`Falha ao atualizar ${ticker}:`, message);
    }
  }

  return jsonResponse({
    sucesso: falhas === 0,
    total: ativos?.length ?? 0,
    atualizados,
    falhas,
    erros,
  });
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
