import React from 'react';
import ReactDOMServer from 'react-dom/server';
import express from 'express';
import { StaticRouter } from 'react-router-dom';
import App from './App';
import path from 'path';
import fs from 'fs';
import { createStore, applyMiddleware } from 'redux';
import rootReducer, { rootSaga } from './modules/index';
import thunk from 'redux-thunk';
import { Provider } from 'react-redux';
import PreloaderContext from './lib/PreloadContext';
import createSagaMiddleware, { END } from 'redux-saga';
import { ChunkExtractor, ChunkExtractorManager } from '@loadable/server';

const statsFile = path.resolve('./build/loadable-stats.json');

function createPage(root, tags) {
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <link rel="shortcut icon" href="/favicon.ico" />
      <meta
        name="viewport"
        content="width=device-width,initial-scale=1,shrink-to-fit=no"
      />
      <meta name="theme-color" content="#000000" />
      <title>react server side rendering</title>
      ${tags.styles}
      ${tags.links}
    </head>
    <body>
      <noscript>You need to enable javascript to run this app</noscript>
      <div id="root">${root}</div>
      ${tags.scripts}
    </body>
  </html>`;
}

const app = express();

// 서버 사이드 렌더링을 처리할 핸들러 함수
const serverRender = async (req, res, next) => {
  // 이 함수는 404가 떠야 하는 상황에 404를 띄우지 않고 서버 사이드 렌더링을 해 줍니다.
  const context = {};

  const sagaMiddleware = createSagaMiddleware();

  const store = createStore(
    rootReducer,
    applyMiddleware(thunk, sagaMiddleware)
  );
  const sagaPromise = sagaMiddleware.run(rootSaga).toPromise();

  const preloadContext = { done: false, promises: [] };

  //필요한 파일을 추출하기 위한 청크 추출기
  const extractor = new ChunkExtractor({ statsFile });

  const jsx = (
    <ChunkExtractorManager extractor={extractor}>
      <PreloaderContext.Provider value={preloadContext}>
        <Provider store={store}>
          <StaticRouter location={req.url} context={context}>
            <App />
          </StaticRouter>
        </Provider>
      </PreloaderContext.Provider>
    </ChunkExtractorManager>
  );

  ReactDOMServer.renderToStaticMarkup(jsx);
  store.dispatch(END); // redux-saga의 END 액션을 발생시키면 액션을 모니터링하는 사가들이 모두 종료 됩니다.
  try {
    await sagaPromise;
    await Promise.all(preloadContext.promises); // 모든 프로세스를 기다립니다.
  } catch (e) {
    return res.status(500);
  }
  preloadContext.done = true;

  const root = ReactDOMServer.renderToString(jsx);
  const staticString = JSON.stringify(store.getState()).replace(
    /</g,
    '\\u003c'
  );
  const staticScript = `<script>__PRELOADED_STATE__ = ${staticString}</script>`; //리덕스 초기 상태를 스크립트로 주입합니다.

  // 미리 불러와야하는 스타일/스크립트를 추출하고
  const tags = {
    scripts: staticScript + extractor.getScriptTags(), // 스크립트 앞부분에 리덕스 상태 넣기
    links: extractor.getLinkTags(),
    styles: extractor.getStyleTags()
  };

  res.send(createPage(root, tags)); // 클라이언트에게 결과물을 응답합니다.
};
//JSON을 문자열로 변환하고 악성 스크립트가 실행되는 것을 방지하기 위해 <을 취한 처리

const serve = express.static(path.resolve('./build'), {
  index: false // "/" 경로에서 index.html을 보여주지 않도록 설정
});

app.use(serve); // 순서가 중요합니다. serverRender보다 전에 위치해야합니ㅏ.

app.use(serverRender);
// 4000 포트로 서버를 가동합니다.
app.listen(4000, () => {
  console.log('Running on http://localhost:4000');
});
