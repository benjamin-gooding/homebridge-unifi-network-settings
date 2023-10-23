import {finalize, map, mergeMap, Observable, of, retry, tap} from 'rxjs';
import fetch, {Headers, RequestInfo, RequestInit, Response} from 'node-fetch';
import {AbortController} from 'abort-controller';
import {API_RETRY_INTERVAL, API_TIMEOUT} from './settings.js';
import {fromPromise} from 'rxjs/internal/observable/innerFrom';
import {Logger} from 'homebridge/lib/logger.js';
import https from 'https';

enum HttpHeaders {
    X_CSRF_TOKEN = 'X-CSRF-Token',
    SET_COOKIE = 'Set-Cookie',
    COOKIE = 'Cookie',
}

export class UnifiHttpClient {

    private readonly _baseUrl: string;
    private readonly _username: string;
    private readonly _password: string;
    private readonly _logger: Logger;
    private readonly _headers: Headers = new Headers({
        'Content-Type': 'application/json',
    });

    constructor(logger: Logger, baseUrl: string, username: string, password: string) {
        this._baseUrl = baseUrl;
        this._logger = logger;
        this._username = username;
        this._password = password;
    }

    public login(): Observable<boolean> {
        const options = {
            method: 'POST',
            body: JSON.stringify({password: this._password, username: this._username}),
        };
        return this._buildRequestOptions(options)
            .pipe(
                mergeMap((options) => this.fetch(this._url('/api/auth/login'), options)),
                tap({
                    error: () => {
                        this._headers.delete(HttpHeaders.X_CSRF_TOKEN);
                        this._headers.delete(HttpHeaders.COOKIE);
                        this._logger.error(`Failed to login, will try again in ${API_RETRY_INTERVAL}ms.`);
                    },
                }),
                retry({
                    delay: API_RETRY_INTERVAL,
                    count: 5,
                    resetOnSuccess: true,
                }),
                map(() => true),
            );
    }

    public get<T>(path: string): Observable<T> {
        return this.login()
            .pipe(
                mergeMap(() => this._buildRequestOptions({method: 'GET'})),
                mergeMap((options) => this.fetch(this._url(path), options)),
                mergeMap((x) => fromPromise(x.json()) as Observable<T>),
            );
    }

    public post<T>(path: string, body: object = {}): Observable<T> {
        return this.login()
            .pipe(
                mergeMap(() => this._buildRequestOptions({
                    method: 'POST',
                    body: JSON.stringify(body),
                })),
                mergeMap((options) => this.fetch(this._url(path), options)),
                mergeMap((x) => fromPromise(x.json()) as Observable<T>),
            );
    }

    private _buildRequestOptions(options: RequestInit): Observable<RequestInit> {
        const baseOptions = {
            headers: this._headers,
            agent: new https.Agent({rejectUnauthorized: false}),
        };

        if (this._headers.has('X-CSRF-Token')) {
            return of({
                ...options,
                ...baseOptions,
            });
        }

        return this.fetch(this._baseUrl, {method: 'GET', ...baseOptions})
            .pipe(
                map(() => ({
                    ...options,
                    ...baseOptions,
                })),
            );
    }

    private _url(path: string): string {
        return `${this._baseUrl}/${path.replace(/^\/+/, '')}`;
    }

    public fetch(url: RequestInfo, options: RequestInit): Observable<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1000 * API_TIMEOUT);
        options.signal = controller.signal;

        return fromPromise(fetch(url, options))
            .pipe(
                tap((response) => {
                    if (!response.ok) {
                        throw response;
                    }
                }),
                tap((response) => {
                    const csrfTokenResponseHeader = response.headers.get('X-CSRF-Token');
                    if (csrfTokenResponseHeader) {
                        this._headers.set('X-CSRF-Token', csrfTokenResponseHeader);
                    }
                    const cookieResponseHeader = response.headers.get('Set-Cookie');
                    if (cookieResponseHeader) {
                        this._headers.set('Cookie', cookieResponseHeader);
                    }
                }),
                finalize(() => clearTimeout(timeout)),
            );
    }


}
