import {
	type KeyExportOptions,
	type KeyPairKeyObjectResult,
	generateKeyPairSync,
} from "node:crypto";

const curve = "secp384r1";
const pem: KeyExportOptions<"pem"> = { format: "pem", type: "sec1" };
const der: KeyExportOptions<"der"> = { format: "der", type: "spki" };

type LoginData = {
	ecdhKeyPair: KeyPairKeyObjectResult;
	publicKeyDER: string | Buffer;
	privateKeyPEM: string | Buffer;
	clientX509: string;
	clientIdentityChain: string;
	clientUserChain: string;
};

export const prepareLoginData = (): LoginData => {
	const ecdhKeyPair = generateKeyPairSync("ec", { namedCurve: curve });
	const loginData: LoginData = {
		ecdhKeyPair: ecdhKeyPair,
		publicKeyDER: Buffer.alloc(0),
		privateKeyPEM: "",
		clientX509: "",
		clientIdentityChain: "",
		clientUserChain: "",
	};

	loginData.ecdhKeyPair = generateKeyPairSync("ec", { namedCurve: curve });
	loginData.publicKeyDER = loginData.ecdhKeyPair.publicKey.export(der);
	loginData.privateKeyPEM = loginData.ecdhKeyPair.privateKey
		.export(pem)
		.toString("base64");
	loginData.clientX509 = loginData.publicKeyDER.toString("base64");

	return loginData;
};

export type { LoginData };
