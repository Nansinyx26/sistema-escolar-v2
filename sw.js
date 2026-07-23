// sw.js — alias de compatibilidade.
//
// O Service Worker real é /service-worker.js. Este arquivo existe apenas para
// que navegadores que já possuem um registro antigo em '/sw.js' (portal do
// responsável) passem a executar exatamente o mesmo código, em vez de manter
// duas implementações concorrentes disputando o mesmo escopo '/'.
importScripts('/service-worker.js');
