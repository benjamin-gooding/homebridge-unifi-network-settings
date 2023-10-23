import {Logger} from 'homebridge/lib/logger';
import {UnifiHttpClient} from './unifi-http-client.js';
import {Observable, tap} from 'rxjs';

export class UnifiNetworkApi {

    private readonly log: Logger;
    private readonly apiClient: UnifiHttpClient;

    constructor(nvrAddress: string, username: string, password: string, logger: Logger) {
        this.apiClient = new UnifiHttpClient(logger, `https://${nvrAddress}`, username, password);
        this.log = logger;
    }

    public listRoutingRules(): Observable<any> {
        return this.apiClient.get('/proxy/network/v2/api/site/default/trafficroutes')
            .pipe(
                tap({
                    next: (value) => {
                        this.log.debug(JSON.stringify(value, null, '\t'));
                    },
                }),
            );
    }
}
