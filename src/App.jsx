import { useEffect, useMemo, useState } from 'react';
import Login from './Login.jsx';
import './AppAuth.css';
import { supabase } from './lib/supabase.js';
import { TYPES, money, pct, portfolio } from './domain.js';
import { emptyPortfolio } from './data.js';
import {
  fetchBrapiAsset,
  fetchBrapiQuotes,
} from './services/marketQuoteService.js';

const cents = value =>
  Math.round(Number(String(value ?? '0').replace(',', '.')) * 100);

const normalizePortfolio = value => ({
  assets: Array.isArray(value?.assets) ? value.assets : [],
  operations: Array.isArray(value?.operations) ? value.operations : [],
});

function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [data, setData] = useState(normalizePortfolio(emptyPortfolio));

  const [page, setPage] = useState('Início');

  const [edit, setEdit] = useState(null);

  const [notice, setNotice] = useState('');

  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data: result, error }) => {
      if (error) console.error('Falha ao recuperar sessão:', error);
      if (active) {
        setSession(result?.session ?? null);
        setAuthLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadPortfolio() {
      if (!session?.user?.id) {
        setData(normalizePortfolio(emptyPortfolio));
        setPortfolioLoading(false);
        return;
      }

      setPortfolioLoading(true);
      try {
        const { data: row, error } = await supabase
          .from('portfolios')
          .select('data')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (error) throw error;
        if (!active) return;

        if (row?.data) {
          setData(normalizePortfolio(row.data));
        } else {
          let localData = null;
          try {
            localData = JSON.parse(localStorage.getItem('minha-carteira-v1') || 'null');
          } catch {
            localData = null;
          }

          const initialData = normalizePortfolio(
            localData && !localData.demo ? localData : emptyPortfolio
          );
          setData(initialData);

          const { error: insertError } = await supabase
            .from('portfolios')
            .upsert(
              { user_id: session.user.id, data: initialData },
              { onConflict: 'user_id' }
            );

          if (insertError) throw insertError;
        }
      } catch (error) {
        if (active) {
          setNotice(error.message || 'Não foi possível carregar sua carteira.');
          setData(normalizePortfolio(emptyPortfolio));
        }
      } finally {
        if (active) setPortfolioLoading(false);
      }
    }

    loadPortfolio();
    return () => { active = false; };
  }, [session?.user?.id]);

  const summary = useMemo(
    () => portfolio(data.assets, data.operations),
    [data]
  );

  const save = async next => {
    setData(next);

    if (!session?.user?.id) {
      setNotice('Sua sessão expirou. Entre novamente para salvar as alterações.');
      return;
    }

    const { error } = await supabase
      .from('portfolios')
      .upsert(
        { user_id: session.user.id, data: next },
        { onConflict: 'user_id' }
      );

    if (error) {
      setNotice(`Erro ao salvar a carteira: ${error.message}`);
      return;
    }

    localStorage.setItem('minha-carteira-v1', JSON.stringify(next));
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) setNotice(error.message || 'Não foi possível sair da conta.');
  };

  if (authLoading) {
    return <div className="app-loading"><span className="loading-spinner" />Verificando sua sessão…</div>;
  }

  if (!session) {
    return (
      <Login
        onLogin={({ email, password }) =>
          supabase.auth.signInWithPassword({ email, password })
        }
        onRegister={({ name, email, password }) =>
          supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: name } },
          })
        }
        onForgotPassword={({ email }) =>
          supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/redefinir-senha`,
          })
        }
      />
    );
  }

  if (portfolioLoading) {
    return <div className="app-loading"><span className="loading-spinner" />Carregando sua carteira…</div>;
  }

  const updateQuotes = async () => {

    setUpdating(true);

    try {

      const result = await fetchBrapiQuotes(data.assets);

      if (!result.quotes.length) {

        throw new Error(

          'Nenhuma cotação encontrada. Verifique ticker ou token.'

        );

      }

      const quoteMap = new Map(

        result.quotes.map(quote => [quote.id, quote])

      );

      save({

        ...data,

        assets: data.assets.map(asset => {

          if (!quoteMap.has(asset.id)) return asset;

          const updatedQuote = quoteMap.get(asset.id);

          return {

            ...asset,

            ...updatedQuote,

            averagePrice: asset.averagePrice ?? asset.quote,

          };

        }),

      });

      setNotice(

        `${result.quotes.length} cotação(ões) atualizada(s)` +

          (result.skipped

            ? `; ${result.skipped} ativo(s) permanecem manuais`

            : '') +

          '.'

      );

    } catch (error) {

      setNotice(

        error.message || 'Falha ao atualizar cotações.'

      );

    } finally {

      setUpdating(false);

    }

  };

  const saveAsset = value => {

    const quantity = Number(

      String(value.quantity ?? '').replace(',', '.')

    );

    const averagePrice = cents(value.averagePrice);

    const asset = {

      id: edit?.id || crypto.randomUUID(),

      name: String(value.name || '').trim(),

      ticker: String(value.ticker || '').trim().toUpperCase(),

      class: value.class,

      quantity,

      averagePrice,

      quote:

        typeof value.quote === 'number'

          ? value.quote

          : averagePrice,

      quoteDate:

        value.quoteDate || new Date().toISOString().slice(0, 10),

      quoteSource: value.quoteSource || 'manual',

      quoteUpdatedAt: value.quoteUpdatedAt || null,

    };

    if (

      !asset.name ||

      !asset.ticker ||

      !asset.class ||

      !Number.isFinite(quantity) ||

      quantity <= 0 ||

      !Number.isFinite(averagePrice) ||

      averagePrice <= 0

    ) {

      setNotice(

        'Informe um ativo válido, a quantidade e o preço médio de compra.'

      );

      return;

    }

    const assets = edit?.id

      ? data.assets.map(item =>

          item.id === asset.id

            ? { ...item, ...asset }

            : item

        )

      : [...data.assets, asset];

    save({

      ...data,

      assets,

    });

    setEdit(null);

    setPage('Carteira');

    setNotice(

      edit?.id ? 'Ativo atualizado.' : 'Ativo cadastrado.'

    );

  };

  const remove = asset => {

    if (

      window.confirm(

        `Excluir ${asset.ticker || asset.name} e suas movimentações?`

      )

    ) {

      save({

        ...data,

        assets: data.assets.filter(

          item => item.id !== asset.id

        ),

        operations: data.operations.filter(

          operation => operation.assetId !== asset.id

        ),

      });

      setNotice('Ativo excluído.');

    }

  };

  const saveMove = value => {

    const quantity = Number(

      String(value.quantity ?? '').replace(',', '.')

    );

    const amount = cents(value.value);

    const fees = cents(value.fees);

    if (

      !value.assetId ||

      !value.date ||

      !Number.isFinite(quantity) ||

      quantity <= 0 ||

      !Number.isFinite(amount) ||

      amount < 0 ||

      !Number.isFinite(fees) ||

      fees < 0

    ) {

      setNotice('Preencha os campos com valores válidos.');

      return;

    }

    save({

      ...data,

      operations: [

        ...data.operations,

        {

          id: crypto.randomUUID(),

          assetId: value.assetId,

          type: value.type,

          date: value.date,

          quantity,

          value: amount,

          fees,

        },

      ],

    });

    setPage('Carteira');

    setNotice('Movimentação salva.');

  };

  let content;

  if (edit !== null) {

    content = (

      <AssetForm

        asset={edit}

        save={saveAsset}

        cancel={() => setEdit(null)}

      />

    );

  } else if (page === 'Início') {

    content = (

      <Home

        summary={summary}

        update={updateQuotes}

        loading={updating}

      />

    );

  } else if (page === 'Carteira') {

    content = (

      <Assets

        rows={summary.rows}

        add={() => setEdit({})}

        edit={setEdit}

        remove={remove}

        update={updateQuotes}

        loading={updating}

      />

    );

  } else if (page === 'Movimentar') {

    content = data.assets.length ? (

      <Move assets={data.assets} save={saveMove} />

    ) : (

      <Empty add={() => setEdit({})} />

    );

  } else if (page === 'Análise') {

    content = <Analysis summary={summary} />;

  } else {

    content = <Settings data={data} save={save} />;

  }

  return (

    <main>

      <header>

        <div>

          <small>Gestão de investimentos</small>

          <h1>Minha Carteira</h1>

        </div>

        <div className="header-actions">
          <span className="user-email">{session.user.email}</span>
          <button className="signout-button" onClick={handleSignOut}>Sair</button>
          <button
          aria-label="Alternar tema"

          onClick={() =>

            document.body.classList.toggle('dark')

          }

        >

          ☾
          </button>
        </div>
      </header>

      {content}

      {notice && (

        <div

          className="toast"

          role="status"

          onClick={() => setNotice('')}

        >

          {notice}

        </div>

      )}

      <nav>

        {[

          'Início',

          'Carteira',

          'Movimentar',

          'Análise',

          'Ajustes',

        ].map(item => (

          <button

            key={item}

            className={

              page === item && edit === null ? 'active' : ''

            }

            onClick={() => {

              setEdit(null);

              setPage(item);

            }}

          >

            {item}

          </button>

        ))}

      </nav>

    </main>

  );

}

function QuoteButton({ update, loading }) {

  return (

    <button

      className="primary compact"

      disabled={loading}

      onClick={update}

    >

      {loading ? 'Atualizando…' : '↻ Atualizar'}

    </button>

  );

}

function Home({ summary, update, loading }) {

  return (

    <>

      <section className="hero">

        <small>Patrimônio atual</small>

        <strong>{money(summary.current)}</strong>

        <span

          className={

            summary.totalReturn >= 0 ? 'positive' : 'negative'

          }

        >

          {pct(

            summary.cost

              ? summary.totalReturn / summary.cost

              : 0

          )}

        </span>

      </section>

      <div className="title-action">

        <h2>Posições</h2>

        <QuoteButton update={update} loading={loading} />

      </div>

      <div className="grid">

        <Card l="Valor aplicado" v={money(summary.cost)} />

        <Card l="Proventos" v={money(summary.income)} />

      </div>

      <Rows

        rows={[...summary.rows]

          .sort((a, b) => b.current - a.current)

          .slice(0, 3)}

      />

    </>

  );

}

function Card({ l, v }) {

  return (

    <article>

      <small>{l}</small>

      <b>{v}</b>

    </article>

  );

}

function Rows({ rows }) {

  return (

    <section>

      {rows.length ? (

        rows.map(row => (

          <article className="asset" key={row.id}>

            <div>

              <b>{row.ticker || row.name}</b>

              <small>

                {row.class} · {row.quantity} un.

              </small>

            </div>

            <div>

              <b>{money(row.current)}</b>

              <small

                className={

                  row.totalReturn >= 0

                    ? 'positive'

                    : 'negative'

                }

              >

                {pct(row.returnPct)}

              </small>

            </div>

          </article>

        ))

      ) : (

        <p className="empty">

          Cadastre seu primeiro ativo para começar.

        </p>

      )}

    </section>

  );

}

function Assets({

  rows,

  add,

  edit,

  remove,

  update,

  loading,

}) {

  return (

    <>

      <div className="title-action">

        <h2>Ativos cadastrados</h2>

        <div className="actions">

          <QuoteButton update={update} loading={loading} />

          <button

            className="primary compact"

            onClick={add}

          >

            + Ativo

          </button>

        </div>

      </div>

      {rows.length ? (

        <section>

          {rows.map(row => (

            <article className="asset" key={row.id}>

              <div>

                <b>{row.ticker || row.name}</b>

                <small>

                  {row.class} ·{' '}

                  {row.quoteSource === 'brapi'

                    ? 'Cotação Brapi'

                    : 'Cotação manual'}

                  {row.quoteUpdatedAt

                    ? ` · ${new Date(

                        row.quoteUpdatedAt

                      ).toLocaleString('pt-BR')}`

                    : ''}

                </small>

                <small>

                  Quantidade: {row.quantity ?? 0} un.

                </small>

                <small>

                  Preço médio:{' '}

                  {money(row.averagePrice ?? row.quote)}

                </small>

              </div>

              <div className="asset-actions">

                <b>{money(row.current)}</b>

                <button onClick={() => edit(row)}>

                  Editar

                </button>

                <button

                  className="danger-link"

                  onClick={() => remove(row)}

                >

                  Excluir

                </button>

              </div>

            </article>

          ))}

        </section>

      ) : (

        <p className="empty">

          Ainda não há ativos cadastrados.

        </p>

      )}

      <p className="hint">

        A atualização automática está disponível para Ações,

        FIIs e ETFs com ticker compatível. Outros ativos

        permanecem com cotação manual.

      </p>

    </>

  );

}

function AssetForm({ asset, save, cancel }) {

  const [ticker, setTicker] = useState(asset.ticker || '');

  const [assetInfo, setAssetInfo] = useState(

    asset.id

      ? {

          ticker: asset.ticker,

          name: asset.name,

          class: asset.class,

          quote: asset.quote ?? null,

          quoteDate: asset.quoteDate,

          quoteUpdatedAt: asset.quoteUpdatedAt,

          quoteSource: asset.quoteSource || 'manual',

        }

      : null

  );

  const [quantity, setQuantity] = useState(

    asset.quantity != null ? String(asset.quantity) : ''

  );

  const [averagePrice, setAveragePrice] = useState(

    asset.averagePrice != null

      ? (asset.averagePrice / 100).toFixed(2)

      : asset.quote != null

        ? (asset.quote / 100).toFixed(2)

        : ''

  );

  const [searching, setSearching] = useState(false);

  const [error, setError] = useState('');

  const searchAsset = async () => {

    if (!ticker.trim()) {

      setError('Informe o código do ativo.');

      return;

    }

    setSearching(true);

    setError('');

    setAssetInfo(null);

    try {

      const result = await fetchBrapiAsset(ticker);

      setAssetInfo(result);

      if (!averagePrice && result.quote != null) {

        setAveragePrice((result.quote / 100).toFixed(2));

      }

    } catch (err) {

      setError(err.message || 'Não foi possível consultar o ativo.');

    } finally {

      setSearching(false);

    }

  };

  const submit = event => {

    event.preventDefault();

    if (!assetInfo) {

      setError('Busque o ativo pelo código antes de salvar.');

      return;

    }

    save({

      ...assetInfo,

      quantity,

      averagePrice,

    });

  };

  const currentQuote = assetInfo?.quote;

  return (

    <>

      <div className="title-action">

        <h2>{asset.id ? 'Editar ativo' : 'Cadastrar ativo'}</h2>

        <button type="button" onClick={cancel}>

          Cancelar

        </button>

      </div>

      <form onSubmit={submit}>

        <label>

          Código do ativo

          <div className="actions">

            <input

              name="ticker"

              value={ticker}

              required

              onChange={event => {

                setTicker(event.target.value.toUpperCase());

                setAssetInfo(null);

                setError('');

              }}

              placeholder="Ex.: PETR4, MXRF11, IVVB11"

            />

            <button

              type="button"

              className="primary compact"

              onClick={searchAsset}

              disabled={!ticker.trim() || searching}

            >

              {searching ? 'Buscando…' : 'Buscar'}

            </button>

          </div>

        </label>

        {assetInfo && (

          <section className="asset-info">

            <p>

              <strong>Nome:</strong> {assetInfo.name}

            </p>

            <p>

              <strong>Classe:</strong> {assetInfo.class}

            </p>

            <p>

              <strong>Cotação atual:</strong>{' '}

              {currentQuote == null

                ? 'Indisponível'

                : money(currentQuote)}

            </p>

          </section>

        )}

        <label>

          Quantidade

          <input

            name="quantity"

            type="number"

            required

            min="0.000001"

            step="any"

            value={quantity}

            onChange={event => setQuantity(event.target.value)}

            placeholder="Ex.: 100"

          />

        </label>

        <label>

          Preço médio de compra (R$)

          <input

            name="averagePrice"

            type="number"

            required

            min="0.01"

            step="0.01"

            value={averagePrice}

            onChange={event => setAveragePrice(event.target.value)}

            placeholder="Ex.: 32.50"

          />

        </label>

        <p className="hint">

          O nome, a classe e a cotação são consultados pela Brapi.

          Informe sua quantidade e seu preço médio de compra.

        </p>

        {error && <p className="error" role="alert">{error}</p>}

        <button className="primary" type="submit" disabled={!assetInfo || searching}>

          {asset.id ? 'Salvar alterações' : 'Cadastrar ativo'}

        </button>

      </form>

    </>

  );

}

function Move({ assets, save }) {

  const submit = event => {

    event.preventDefault();

    save(

      Object.fromEntries(

        new FormData(event.currentTarget)

      )

    );

  };

  return (

    <>

      <h2>Nova movimentação</h2>

      <form onSubmit={submit}>

        <label>

          Ativo

          <select name="assetId" required>

            {assets.map(asset => (

              <option key={asset.id} value={asset.id}>

                {asset.ticker || asset.name}

              </option>

            ))}

          </select>

        </label>

        <label>

          Tipo

          <select name="type" required>

            {Object.values(TYPES).map(type => (

              <option key={type} value={type}>

                {type}

              </option>

            ))}

          </select>

        </label>

        <label>

          Data

          <input

            name="date"

            required

            type="date"

            defaultValue={new Date()

              .toISOString()

              .slice(0, 10)}

          />

        </label>

        <label>

          Quantidade

          <input

            name="quantity"

            required

            type="number"

            min="0"

            step="any"

          />

        </label>

        <label>

          Valor total (R$)

          <input

            name="value"

            required

            type="number"

            min="0"

            step="0.01"

          />

        </label>

        <label>

          Taxas (R$)

          <input

            name="fees"

            type="number"

            min="0"

            step="0.01"

            defaultValue="0"

          />

        </label>

        <button className="primary" type="submit">

          Salvar movimentação

        </button>

      </form>

    </>

  );

}

function Empty({ add }) {

  return (

    <section className="empty">

      <h2>Cadastre um ativo primeiro</h2>

      <p>

        Movimentações precisam estar vinculadas a um ativo.

      </p>

      <button className="primary" onClick={add}>

        Cadastrar ativo

      </button>

    </section>

  );

}

function Analysis({ summary }) {

  return (

    <>

      <h2>Distribuição por classe</h2>

      {summary.classes.length ? (

        summary.classes.map(item => (

          <article key={item.name}>

            <b>{item.name}</b>

            <small>

              {money(item.value)} ·{' '}

              {pct(

                summary.current

                  ? item.value / summary.current

                  : 0

              )}

            </small>

          </article>

        ))

      ) : (

        <p className="empty">

          A análise será exibida após o cadastro de ativos.

        </p>

      )}

      <p className="hint">

        Rentabilidade passada não é garantia de resultados futuros.

      </p>

    </>

  );

}

function Settings({ data, save }) {

  const clear = () => {

    if (window.confirm('Apagar todos os dados da sua carteira?')) {

      save(emptyPortfolio);

    }

  };

  const exportData = () => {

    const blob = new Blob(

      [JSON.stringify(data, null, 2)],

      { type: 'application/json' }

    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');

    link.href = url;

    link.download = 'minha-carteira.json';

    link.click();

    URL.revokeObjectURL(url);

  };

  return (

    <>

      <h2>Dados</h2>

      <button className="wide" onClick={exportData}>

        Exportar JSON

      </button>

      <button

        className="wide danger-link"

        onClick={clear}

      >

        Apagar dados da carteira

      </button>

    </>

  );

}

export default App;
