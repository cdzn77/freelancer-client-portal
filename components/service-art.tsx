/** Decorative, monochrome service studies; the adjacent heading labels each card. */
export function ServiceArt({ service }: { service: string }) {
  const line = { fill: "none", stroke: "#191919", strokeWidth: 1.25 } as const;
  const guide = { fill: "none", stroke: "#d5d5d5", strokeWidth: 0.75 } as const;
  return (
    <svg
      className="service-art"
      viewBox="0 0 220 132"
      aria-hidden="true"
      focusable="false"
    >
      {service === "ux-strategy" ? (
        <>
          <path d="M24 108H202M34 16V116M34 78H190M34 48H190" {...guide} />
          <path d="M35 94L78 69L123 81L183 30" {...line} />
          <circle cx="78" cy="69" r="3" fill="#191919" />
          <circle cx="123" cy="81" r="3" fill="#fff" stroke="#191919" />
          <circle cx="183" cy="30" r="13" {...line} />
          <circle cx="183" cy="30" r="3" fill="#191919" />
          <path d="M44 26H77M44 32H63" {...guide} />
        </>
      ) : service === "product-design" ? (
        <>
          <path d="M27 109H197" {...guide} />
          <rect x="27" y="20" width="143" height="81" rx="2" {...line} />
          <path d="M27 34H170" {...guide} />
          <circle cx="36" cy="27" r="1.5" fill="#191919" />
          <rect x="39" y="46" width="49" height="42" fill="#ededed" />
          <path d="M101 48H153M101 55H141M101 79H126" {...line} />
          <rect
            x="155"
            y="53"
            width="37"
            height="61"
            rx="2"
            fill="#fff"
            stroke="#191919"
            strokeWidth="1.25"
          />
          <rect x="161" y="64" width="25" height="28" fill="#191919" />
          <path d="M165 102H182" {...guide} />
        </>
      ) : service === "prototype" ? (
        <>
          <rect x="25" y="24" width="53" height="77" rx="2" {...line} />
          <rect x="35" y="35" width="33" height="30" fill="#ededed" />
          <path d="M35 78H66M35 85H55" {...guide} />
          <path d="M79 63H116V83H141m-6-5 6 5-6 5" {...line} />
          <rect x="142" y="36" width="53" height="77" rx="2" {...line} />
          <path d="M153 49H183M153 55H173" {...guide} />
          <circle cx="168" cy="83" r="13" fill="#191919" />
          <path d="m165 78 8 5-8 5Z" fill="#fff" />
          <path d="M94 22H126M110 6V38" {...guide} />
        </>
      ) : service === "design-system" ? (
        <>
          <path
            d="M24 19H197M24 113H197M31 12V120M189 12V120M110 19V113M31 66H189"
            {...guide}
          />
          <rect x="41" y="30" width="57" height="24" rx="12" fill="#191919" />
          <path d="M54 42H85" stroke="#fff" strokeWidth="1" />
          <circle cx="139" cy="42" r="12" {...line} />
          <circle cx="169" cy="42" r="12" fill="#e5e5e5" />
          <rect x="42" y="78" width="24" height="24" {...line} />
          <rect x="74" y="78" width="24" height="24" fill="#ededed" />
          <path d="M126 85H178M126 94H160" {...line} />
        </>
      ) : service === "brand-campaign" ? (
        <>
          <rect x="35" y="31" width="99" height="73" fill="#ededed" />
          <rect
            x="86"
            y="17"
            width="98"
            height="98"
            fill="#fff"
            stroke="#191919"
            strokeWidth="1.25"
          />
          <path
            d="M104 81V40h9l22 29 22-29h9v41h-9V55l-22 29-22-29v26Z"
            fill="#191919"
          />
          <path d="M103 99H166M45 45H72M45 51H63" {...guide} />
          <path d="M80 17H72M86 11V3M184 121V129M190 115H198" {...line} />
        </>
      ) : (
        <>
          <circle cx="92" cy="65" r="39" {...guide} />
          <circle cx="132" cy="65" r="39" {...line} />
          <path d="M112 39V91M86 65H138" {...line} />
          <circle cx="112" cy="65" r="3" fill="#191919" />
          <path d="M29 113H61M163 17H195" {...guide} />
        </>
      )}
    </svg>
  );
}
