# ✈ Voos ao vivo

Um mapa interativo com os aviões que estão a voar neste momento no mundo inteiro.

- Cada avião aparece rodado na direção em que voa, com uma cor que indica a altitude.
- O mapa atualiza-se sozinho a cada 30 segundos, sem recarregar a página.
- Ao carregar num avião, abre um painel com o número do voo, o país, a altitude, a velocidade, a direção, se está a subir, a descer ou em cruzeiro, e a hora da última atualização.
- O painel mostra também a origem, o destino e a companhia aérea, e o mapa desenha a rota em curva (círculo máximo) a passar pela posição atual do avião.
- No topo há o total de aviões no ar e uma caixa para procurar um voo pelo callsign (ex.: `TAP123`).
- Funciona no computador e no telemóvel.

Feito só com HTML, CSS e JavaScript simples, mais a biblioteca [Leaflet](https://leafletjs.com) para o mapa.

## Como abrir

Precisas do [Node.js](https://nodejs.org) (versão 18 ou mais recente). Não há nada para instalar com `npm`.

1. Abre um terminal na pasta do projeto.
2. Corre:

   ```bash
   node server.js
   ```

3. Abre no browser: **http://localhost:8080**
4. Para parar o servidor, carrega em `Ctrl + C` no terminal.

> **Porque não basta fazer duplo clique no `index.html`?**
> A OpenSky só aceita pedidos feitos pelo browser a partir do site dela (uma regra de segurança chamada CORS).
> O `server.js` resolve isso: corre no teu computador, vai buscar os dados à OpenSky e entrega-os à página.

## Ficheiros

| Ficheiro | O que faz |
|---|---|
| `index.html` | A estrutura da página: barra do topo, mapa, legenda e painel lateral. |
| `style.css` | O aspeto: cores, tamanhos, e a versão para telemóvel. |
| `app.js` | A lógica: mapa, desenho dos aviões, atualizações, painel, rota e pesquisa. Está comentado em português, secção a secção. |
| `server.js` | O pequeno servidor local que serve a página e vai buscar os voos à OpenSky. |
| `config.exemplo.json` | Modelo para pores as tuas credenciais da OpenSky (opcional). |

## De onde vêm os dados

- **Posições dos aviões:** [OpenSky Network](https://opensky-network.org), uma rede de recetores ADS-B mantida por voluntários e universidades.
- **Origem, destino e companhia:** [adsbdb](https://www.adsbdb.com). Só é pedida quando carregas num avião, e cada resposta fica guardada para não repetir pedidos.
  Atenção: é uma base de dados de rotas *habituais* para cada número de voo, por isso pode não estar 100% certa. Se não conhecer o voo, aparece "Rota desconhecida".
- **Mapa base:** Esri (World Dark Gray), com dados do OpenStreetMap. O mapa escuro da CARTO passou a pedir uma chave de API, por isso não o usamos.

## Limite de pedidos da OpenSky

Sem conta, a OpenSky dá **400 créditos por dia**, e cada atualização do mundo inteiro gasta 4. Isso dá cerca de **100 atualizações por dia**, ou seja, uns 50 minutos de mapa aberto a atualizar de 30 em 30 segundos.

Para poupar pedidos:

- a página deixa de atualizar quando mudas de aba ou minimizas o browser;
- o servidor reaproveita a mesma resposta durante 20 segundos, mesmo com várias abas abertas;
- a barra do topo mostra quantas atualizações ainda tens hoje.

Quando o limite acaba, aparece uma mensagem e o mapa continua a mostrar os últimos aviões recebidos.

### Ter 10 vezes mais pedidos (grátis)

1. Cria uma conta gratuita em [opensky-network.org](https://opensky-network.org).
2. Na página da tua conta, cria um *API client* e copia o `client_id` e o `client_secret`.
3. Copia o ficheiro `config.exemplo.json` para um novo ficheiro chamado `config.json` e cola lá os teus dados.
4. Reinicia o servidor (`Ctrl + C` e depois `node server.js` outra vez).

Com conta tens 4000 créditos por dia, cerca de 1000 atualizações.
O `config.json` está no `.gitignore`, por isso as tuas credenciais nunca vão para o GitHub.

## Ideias para continuar

- Mudar `INTERVALO_MS` no início do `app.js` para atualizar mais ou menos vezes.
- Mudar as cores em `CORES_ALTITUDE` ou o tamanho dos aviões em `TAMANHO_AVIAO`.
- Mostrar o rasto dos últimos minutos do avião escolhido.
- Filtrar só os voos de uma companhia aérea.

## Publicar no GitHub

O projeto já é um repositório git com um primeiro commit. No GitHub Desktop:
**File → Add local repository…**, escolhe esta pasta e carrega em **Publish repository**.

Nota: o GitHub Pages só serve ficheiros estáticos e não corre o `server.js`. Para outras pessoas usarem o mapa, têm de o correr no computador delas, ou terás de alojar o servidor num serviço que corra Node.js (por exemplo Render ou Railway).
