/** Dünya, bulut ve atmosfer shader'ları. Işık yönü gerçek Güneş-altı noktasından gelir. */

export const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const earthFragment = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D specMap;
  uniform sampler2D normalMap;
  uniform sampler2D cloudMap;
  uniform vec3 sunDir;
  uniform float cloudOffset;
  uniform float realLighting;
  uniform float nightIntensity;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-6, 0.0, 0.0));
    vec3 north = cross(n, east);
    vec3 nm = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
    vec3 pn = normalize(n + (east * nm.x + north * nm.y) * 0.35);

    vec3 L = realLighting > 0.5 ? normalize(sunDir) : normalize(cameraPosition);
    vec3 V = normalize(cameraPosition - vWorldPos);

    float sunDot = dot(n, L);
    float diffuse = max(dot(pn, L), 0.0);
    float dayMix = smoothstep(-0.12, 0.18, sunDot);

    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 night = texture2D(nightMap, vUv).rgb;
    float ocean = texture2D(specMap, vUv).r;

    // bulut gölgesi (Güneş yönünde hafif kaydırılmış)
    // fract() kullanılmaz: sarma noktasında türev sıçrar, mipmap seçimi bozulur ve ince bir dikey çizgi çıkar.
    // Doku RepeatWrapping ile yüklendiği için sarmayı doku birimi kesintisiz yapar.
    vec2 cuv = vec2(vUv.x + cloudOffset, vUv.y);
    float cloudShadow = texture2D(cloudMap, cuv).r;

    vec3 color = day * (0.025 + diffuse * 1.15) * (1.0 - cloudShadow * 0.35);

    // okyanus parlaması (Blinn-Phong)
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(n, H), 0.0), 60.0) * ocean * dayMix;
    color += vec3(1.0, 0.93, 0.8) * spec * 0.55;

    // gün batımı kuşağı
    float terminator = smoothstep(-0.1, 0.0, sunDot) * (1.0 - smoothstep(0.0, 0.22, sunDot));
    color += vec3(0.3, 0.12, 0.03) * terminator * 0.12;

    // şehir ışıkları gece tarafında
    vec3 lights = pow(night, vec3(1.4)) * vec3(1.0, 0.82, 0.55) * nightIntensity;
    color += lights * (1.0 - dayMix) * (1.0 - cloudShadow * 0.6) * realLighting;

    // atmosferik saçılma — kenara doğru mavi pus
    float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    color = mix(color, vec3(0.32, 0.55, 1.0) * (0.25 + dayMix), fres * 0.55 * (0.3 + 0.7 * dayMix));

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const cloudVertex = earthVertex;

export const cloudFragment = /* glsl */ `
  uniform sampler2D cloudMap;
  uniform vec3 sunDir;
  uniform float cloudOffset;
  uniform float realLighting;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 L = realLighting > 0.5 ? normalize(sunDir) : normalize(cameraPosition);
    float a = texture2D(cloudMap, vec2(vUv.x + cloudOffset, vUv.y)).r;
    a = smoothstep(0.08, 0.9, a);
    float light = smoothstep(-0.15, 0.35, dot(n, L));
    vec3 col = vec3(1.0) * (0.04 + light * 0.96);
    gl_FragColor = vec4(col, a * 0.92 * (0.25 + 0.75 * light));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const atmosphereVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const atmosphereFragment = /* glsl */ `
  uniform vec3 sunDir;
  uniform float realLighting;
  uniform float limbDot;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    // Arka yüzü çizilen biraz büyük bir küre: halo, Dünya kenarında en parlak, dışa doğru söner.
    vec3 n = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float a = smoothstep(0.0, limbDot, -dot(n, V));
    float glow = pow(a, 3.0);
    // bu pikselin karşılık geldiği uzuv (limb) yönü
    vec3 limb = normalize(vWorldPos - V * dot(vWorldPos, V));
    vec3 L = realLighting > 0.5 ? normalize(sunDir) : normalize(cameraPosition);
    float sun = smoothstep(-0.4, 0.5, dot(limb, L));
    vec3 col = mix(vec3(0.06, 0.12, 0.4), vec3(0.3, 0.6, 1.0), sun);
    gl_FragColor = vec4(col * glow * (0.15 + 0.85 * sun) * 1.4, 1.0);
  }
`;

export const starVertex = /* glsl */ `
  attribute float size;
  attribute float twinkle;
  uniform float time;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = 0.55 + 0.45 * sin(time * (0.4 + twinkle) + twinkle * 40.0);
    gl_PointSize = size;
  }
`;

export const starFragment = /* glsl */ `
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.0, r) * vAlpha;
    gl_FragColor = vec4(vec3(0.9, 0.95, 1.0), a);
  }
`;
