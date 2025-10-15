export const ASPECT_CONFIG = {
  SUMMARY_URL: "https://d2g31fqhakzf6l.cloudfront.net/aspects_summary.json",
  TOP_TERMS_URL: "https://d2g31fqhakzf6l.cloudfront.net/aspect_top_terms.json",
  BUNDLE_URL: "https://d2g31fqhakzf6l.cloudfront.net/aspects_bundle.json",
};

export const CONFIG = {
  API_BASE: "https://sa0cp2a3r8.execute-api.us-east-1.amazonaws.com/dev",
  WS_BASE: "https://d1n59ypscvrsxd.cloudfront.net/production",
};

export const COGNITO = {
  domain: "spirulina.auth.us-east-1.amazoncognito.com",
  clientId: "oh2vf9imle1l56nkk6fmkte0i",
  redirectUri: "http://localhost:3001/",
  scopes: ["openid", "email"],
  useIdToken: true,
};
