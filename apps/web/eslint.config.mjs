import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
	...nextCoreWebVitals,
	{ ignores: [".next/**", "out/**", "next-env.d.ts"] },
	{
		rules: {
			// ponytail: pre-existing drawer-populate effect; refactor to event-handler state when touched next
			"react-hooks/set-state-in-effect": "warn",
		},
	},
];

export default config;
