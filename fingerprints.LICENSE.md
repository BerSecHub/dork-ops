# Licences of the fingerprints snapshot (`fingerprints.js`)

`fingerprints.js` is derived from two sources. Everything else in this repository is under the MIT
License — see `LICENSE`.

## The queries — ProjectDiscovery's awesome-search-queries

`QUERIES.yaml` from <https://github.com/projectdiscovery/awesome-search-queries>, MIT License. One query
is kept per engine and product; `tools/update-libraries.mjs` rebuilds the file from the original and lists
what it changes.

```text
MIT License

Copyright (c) 2023 ProjectDiscovery

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## The ranking — CISA's Known Exploited Vulnerabilities catalog

Which products come first, and the CVE shown with them, come from the KEV catalog
(<https://www.cisa.gov/known-exploited-vulnerabilities-catalog>). CISA states:

> The KEV database is distributed under the Creative Commons 0 1.0 License. You may use this data in any
> legal manner but note that information provided at any 3rd party links included in the KEV database are
> bound by the policies and licenses of those 3rd party websites. Use of the information does not authorize
> you to use the CISA Logo or DHS Seal, nor should such use be interpreted as an endorsement by CISA or DHS.

A product is marked as being on the list when CISA names the same vendor and every word of the product's
name appears in the KEV product name. The match is deliberately strict, and it is still a match between two
naming schemes: check the catalog itself before acting on it.
