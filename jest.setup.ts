import * as fs from 'fs';
import * as path from 'path';
import fetchMock from 'jest-fetch-mock';

// Troca o `fetch` global pelo mock; cada teste decide se quer mockar
// respostas (fetchMock.mockResponseOnce) ou deixar passar pro fetch real.
fetchMock.enableMocks();
fetchMock.dontMock();

// src/config/load-environments.ts roda `loadEnvironments()` como efeito
// colateral do import e exige um environments.json real (mesmo pré-requisito
// documentado no README para rodar o servidor). Sem isso, qualquer teste que
// importe (direta ou transitivamente) environment.service.ts/config.mcp-provider.ts
// quebraria num clone novo/CI. Provisiona a partir do exemplo só se não
// existir — nunca sobrescreve um environments.json real já configurado.
const environmentsPath = path.join(__dirname, 'environments.json');
const examplePath = path.join(__dirname, 'environments.example.json');
if (!fs.existsSync(environmentsPath) && fs.existsSync(examplePath)) {
  fs.copyFileSync(examplePath, environmentsPath);
}
