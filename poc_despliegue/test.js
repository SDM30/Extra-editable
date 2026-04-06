import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  vus: 100,           // usuarios concurrentes
  duration: '30s',   // duración de la prueba
};

export default function () {
  http.post('http://localhost:8080/api/evaluacion');
  sleep(1);
}