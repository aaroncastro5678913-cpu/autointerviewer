import React from 'react';

// A self-contained, good-looking illustrated "hiring manager" avatar.
// When `speaking` is true, the mouth animates (lip-sync feel) and a soft ring
// pulses. `compact` renders a smaller inline version for the interview header.
export default function InterviewerAvatar({ speaking = false, compact = false }) {
  return (
    <div className={`avatar-wrap ${compact ? 'compact' : ''} ${speaking ? 'is-speaking' : ''}`}>
      <span className="avatar-ring" aria-hidden="true" />
      <svg className="avatar-svg" viewBox="0 0 200 200" role="img" aria-label="Interviewer Alex">
        <defs>
          <linearGradient id="avBg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e0ecff" />
            <stop offset="1" stopColor="#bcd4ff" />
          </linearGradient>
          <clipPath id="avClip">
            <circle cx="100" cy="100" r="100" />
          </clipPath>
        </defs>

        <g clipPath="url(#avClip)">
          <rect width="200" height="200" fill="url(#avBg)" />

          {/* Suit / shoulders */}
          <path d="M34 205 Q40 150 100 150 Q160 150 166 205 Z" fill="#1f3a5f" />
          {/* Suit lapels */}
          <path d="M100 150 L80 165 L96 196 Z" fill="#16314f" />
          <path d="M100 150 L120 165 L104 196 Z" fill="#16314f" />
          {/* Shirt + tie */}
          <path d="M88 152 L100 172 L112 152 Z" fill="#ffffff" />
          <path d="M97 153 L103 153 L107 188 L100 198 L93 188 Z" fill="#2563eb" />

          {/* Neck */}
          <rect x="88" y="120" width="24" height="34" rx="11" fill="#e7b393" />

          {/* Head */}
          <ellipse cx="100" cy="96" rx="38" ry="40" fill="#f2c6a6" />
          {/* Ears */}
          <circle cx="63" cy="100" r="7" fill="#f2c6a6" />
          <circle cx="137" cy="100" r="7" fill="#f2c6a6" />

          {/* Hair */}
          <path d="M60 96 Q56 54 100 54 Q144 54 140 96 Q134 80 118 74 Q112 86 92 82 Q74 82 66 94 Q63 96 60 96 Z" fill="#37302b" />

          {/* Eyebrows */}
          <rect x="76" y="86" width="17" height="4.5" rx="2.25" fill="#37302b" />
          <rect x="107" y="86" width="17" height="4.5" rx="2.25" fill="#37302b" />
          {/* Eyes */}
          <circle cx="85" cy="97" r="4.2" fill="#2a2a2a" />
          <circle cx="115" cy="97" r="4.2" fill="#2a2a2a" />
          {/* Nose */}
          <path d="M100 101 L96 112 L104 112 Z" fill="#e0a886" />
          {/* Cheeks */}
          <circle cx="78" cy="110" r="6" fill="#f3a98c" opacity="0.5" />
          <circle cx="122" cy="110" r="6" fill="#f3a98c" opacity="0.5" />

          {/* Mouth (animated while speaking) */}
          <ellipse className="avatar-mouth" cx="100" cy="122" rx="11" ry="3.4" fill="#9c3f45" />
        </g>
      </svg>
    </div>
  );
}
