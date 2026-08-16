import { useEffect, useRef } from "react";
import { Animated, Dimensions, Image, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";

// Ported from apps/web/components/strategy/StrategyBuilder.tsx's
// AmbientAurora — same palette, same per-bar keyframe curves and durations,
// same linear-gradient fade. RN 0.86 supports the CSS `filter` style (incl.
// blur) natively — no native module needed.
//
// Two things web's version has that a literal 18-bar/56px-blur port didn't
// reproduce on a phone:
//  1. On web the blur radius comfortably exceeds the gap between bars (they
//     fully overlap into one continuous wash — an aurora, not columns). A
//     blur scaled down proportionally to screen width keeps the same
//     blur-to-viewport RATIO, but at phone size that's nowhere near enough
//     absolute overlap between neighboring bars — they read as separate
//     glowing beams instead of merging. Fewer, wider bars + blur sized off
//     the actual bar pitch (not screen width) fixes that.
//  2. Web's blur is a browser compositor blur, which has a naturally
//     textured/grainy look at low opacity over near-black — not a perfectly
//     smooth gradient. RN's blur filter renders too cleanly to read the
//     same, so a tiled noise texture is layered on top (unblurred, low
//     opacity) to reproduce that same slightly gritty texture.
const BAR_COUNT = 9;
const BAR_GAP = 4;
const { width: SCREEN_WIDTH } = Dimensions.get("window");
const BAR_PITCH = (SCREEN_WIDTH - (BAR_COUNT - 1) * BAR_GAP) / BAR_COUNT;
const MOBILE_BLUR = Math.round(BAR_PITCH * 1.7);

const NOISE_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAgAElEQVR4nB2aeTxb6dvGY2lr6K460w1dLCGxROxrxBqJNbEnIYTEThKEEBKiQiRECAlqmSqDLlpd6HQ61WKobaar0lb7U1pVWlWq6v2c99/8dXKe+7mv6/peB2RsbGz077//luNwOLyxsbFFa2trDYVCaYiJicHcvn27cGpqivj582fPv//+2zsnJyd9aGjIJDAwMOPbt2/ip0+fGoFAICKBQAh1d3e38PHxSYiMjLRfXV11ef/+PbesrKygvr4ejkAg6o8ePcr5999/fa9cuULu6uo6W11dTXdwcOANDw+LWSyWm0QiQXV3d/Pd3d2hBAKh6v3792EDAwO1hw8fLmGxWPEzMzMZYDAYcfr0afjLly/J79+/d4LBYEYgY2NjX5lM5kQmk2nNzc2s1dVVTl5enl1lZSVua2uLLxaL/Q4fPpz6yy+/RPB4vFQ1NTX70dHR0N7e3pzPnz87FhQUBJNIJO6PHz8StbS0MpFIZFhMTAynp6cn9siRI5EbGxvVNjY2DteuXYsKCQnhlpSUeOnq6rpLJBI7f3//NHV1demrV6/ys7Ky4Pv376+ur6+vKy8vpywuLgqrqqpCdu3alTE/P+/a19cn4vF4NFVV1ert7W0Gj8crNzEx8QdRKBR3gUCQvL6+nuXr6xtEo9FipVIp/fbt25ClpSXY3r176Q0NDdTMzMyqI0eO2P3zzz+Mzc3NmsTExIaXL18GnjhxwuDGjRup9vb2+UVFRe7Pnz9PHRkZ8ff3908WiUThcDg85fv37zGOjo5ZdXV1TAwGk7Bjx46gzc3NtPb29vCwsLDyiYkJ3qVLl5KCgoKq+/v7cXp6el4aGhp5GRkZiZOTk9T9+/eTlJWV3YyNjdMWFxdj+Xy+wc2bN9EGBgYBIAsLC7lYLIb7+PiQT5w4USYSibj//fcfanl5uayvrw+Xm5sLyc/PJ4pEIqMPHz6EE4nENBqNVmNjY8P49u1bw82bNxkGBgbyra0tqomJiZ+ZmRnKyckp6fr168VbW1vkjo6OcgcHh/jl5eVwCASS6e/vH+Dt7S1saGhw7O/v9zUzM5MeOnTI/+3btzGmpqZn9+zZU1tZWUkJCQkpzsjIEKanp1cymcy4Q4cOJdvb2zO+f/9ulJKSAt/a2srr6+tjgYKCglInJydzFxYW7J88eRI6MTFRSyKR8AwGgz87O5s3Pj5eHxkZSVJVVY0vLS01aGtrK3jz5o0FHo/3s7CwSEUgELbT09MMf3//HG9vb2leXp61rq6uBZ/PL/Pz85OMjY1lGRgYcLa3tyNDQ0PNfHx8+CdPnvSdnJxMunr1qv3U1BT7wYMHdvn5+eiurq5Ma2try66urpCKiorQf//910tVVdU2KCjI+3//+5+ETqfHfPz4EV9fX38WeL7q6mo2iEAgROfl5UkiIyO9fX19ufv378fD4XCBhoaGvq2tbUlcXBxYS0sLGI9wS0vLOBUVFXsSidRw9+5dwt27d21UVFSgvr6+Hu/fv29YWVnxSEhIKB0bGxO8e/cuA4FAuE1MTPiNjo76bWxsGJ0/fx62Z88et9nZWemOHTtyc3NzZRoaGsyPHz/mOTs7J29tbRHNzMw8S0pKjFJTU1F9fX35BAIBdfbs2axPnz4xDxw4YHP//n3gd97Q0JDljRs3KkFSqdT17NmzHjExMfnA5QPmPjk5WcpisSgQCCSBxWJVXb9+naeqqhrW2tpqi8fjbZSUlIQ9PT2479+/5+no6IDpdLqNUChELS0tSYuKimgwGKy4sLAw/sWLF+VyuVyempp6tquri3HlyhXb/fv3e9XX16OJRGLBwMBAPJvNZioqKrpjMBh0dHS0qa+vr8nJkyfRCgoK6Xfu3Anp6uqy7uzsLLp3716qtrY2QygUWisoKESCQCAbNpstBs3OzsarqqqamZiYuABbx9fXV6yrq0u0s7MT3rp1C/Xt27fCiIgINBKJhH/9+tWcy+Vijx49Gmxvb1/p7Ows4PF4tu7u7uk8Hg/75cuXIENDw/wLFy6YCQQCsoODg115ebk+lUo1T0hIwISHhwdKJBJkSUkJWyaTcXE4nB0Gg6nh8XgFzs7OpikpKdVOTk5YoVDoLJFInMvKykyOHTsGMTY2th4eHnbet29fFgaDib537x5ndXXVWltbmwiytLSUvHnzJnpmZsb62LFjPsePH7cTCASkmzdvOvz333+GEokk/fPnz6WamprFy8vLDePj43UFBQXc06dPl2xtbYlwOBwahUJBmExmUXd3t9XMzAxGJBI5qaqqsrW0tBzs7e2TdHR0ohAIRMrQ0BCqvr4+Uk1NDRIcHOy8ublp0dvbay0QCJw7Ojry4+PjTdzc3Gqam5tTTU1NqzQ0NEq9vLyyBgYGfKKioqAdHR2Ovr6+hP379yf09PSEP378OAJkZ2dH2NjYMKVSqZaKiorwJ0+eOLu6uuZyOBzP58+fu6LRaJqioiJ6dXWV/OnTJwMOhxOnra1N0dXVbejs7IThcDg2CAQq9vb2rkSj0Wxtbe0cJpNZPTo6Wnrnzp1cYBtNT0+bkclkNolEMv7rr79IgCgVFhZWREdHM9XU1IKBnb+9vV3d2NgIjY6Otl5bW8tpb29P9vf3D5fJZBQdHR08kUhkVldXuzg6OkaeO3fO/OrVq+abm5u5oJaWFt6DBw8EX79+rVZTU0t49uxZyf3797PW19fpxcXFIj09vcKwsLDq2dlZ09zc3MSRkZG8169fF2loaMjMzc2DLl68GG1ra2uYk5MjiIuL86HRaDKxWFzQ3d0dfvLkSae5uTm6k5OTJRgMhuBwuJCmpqZAEolkqaenh6iqqoKvrKxkPXz40OrWrVsEmUzmFhQUhH706FHtvn378p2dnf16e3sTQ0ND6/B4vGNTU5O8qampeM+ePZTu7m7JzZs3nUG7d+82raysjJ+cnMxzcXHx/vDhQ9n9+/cRhoaGcjMzs/p3796VvX79Gp+YmOj28ePHmJKSEt/6+np6bW2trZWVFXx0dLSgtLTU7NWrV6VVVVU5i4uLHt7e3rZRUVGh+vr64QYGBunl5eWSgwcPxv/9998hdDqdODU1xVpaWiqJjY21XlxcdMBisdxTp06lf/36NW99fd3U2Ng4D7gDUCg0KjMzE+Xq6powNjYGp1KpnP379wObjhcZGckIDQ0tB62srCC1tbUFMpmspri4uFRBQYH85csXz62tLauNjY3EP/74w+348ePk8fFxyuDgYML58+cD9fX1gXGjXbhwIXN4eBg4ziBra2vukSNHEgcGBtKHh4eR/f39AhsbG0tlZWXw+fPnk2pqakRtbW0ec3NzsQMDA5YRERFgHo9HuXr1KrWjoyPW39/fDwqFOj9//jzY1NTU859//qnf3NzMNDc3t/fz8/NKTk6uAYFAZkNDQ8BYs37+/Omlrq4eBVJXV8cbGBjIGhsbq8RisQ2DwQAMWv6nT59CW1tbS729vbEgEIhsZ2dn+fjxY8DnFN26dSvk7t27zAcPHvA2NzdL2traMq9du2YXFxenPzAwEJqdnc1sbW1NeP36tXteXh5mdXWViMPhkD9+/MDV1NRAP3/+nHT+/Pl8Lpfr39/fX/L333/LkEgk8/Pnz7FLS0vus7OzCMCLqKmpVfP5/BgDA4NUdXX1nOnp6bLv379XX7x40XVwcLDO1tbWDdTd3U1msVhWurq6GS9evMgYGxvLjoqKwqBQKMHCwoK+qampA6DU/f39MJFI5DY1NRXy/fv33JSUFMzS0hJzz549BhAIJOvr16+YCxcuMFJSUgyzs7OTUSiU9+nTp6MiIiLK4+PjM0QiEZ7NZiPT0tJELBYLNjo6WqOgoACcgvXg4CD53LlzFDqdDowl/eTJkxBfX1/cwMBAKR6PN25ubqbDYDArCoVicffuXe/Gxkbx+/fvy8RicSXowIED/g8fPoTX1dU1NDQ0GOTl5RFaWlpYWlpaaW/evAm5fft23n///SdfWVk5CwgMi8UKOnToUB0YDLa+evUqsampKbGjo6NSUVHRk0QiZScmJkY5Ozt7l5WVBXM4HLvHjx8bYTCY2lOnTsn09PSSpFIpY3Fx0TYuLs63vLzcdnt7O/vKlSuO2dnZ0Lm5uRSJRFKclZUlIpFIZmpqauFDQ0NpSkpKgr1792JCQkK8NDU1xX/++Wf8nj17XP755x8hiMPh+D1+/NhXR0dH1NjYWEGlUpkymSxeV1c3AQwGU4A3GBkZidDU1Aw8evSoiYaGRlhQUJDX1tYWIEhCIyMj483NTc+KigpjbW3tzIcPHzpAoVCpTCYz+f3333PPnz9vnp+fb6GiouJ7586dwqioqHxXV9dwJpMZGRMTw3B1dcWRyeQaMBhs8ObNmxhra+tAa2trGhKJjFRQUCiemJiAOTs7u4+NjTkKhUJEbm5uztWrV6uwWCy1oqKCDWKxWAhtbe36M2fOVHh6ekqVlJSSfv78mRQdHU0oLi72mZub49ra2qIePnwYuHPnTtP4+PgADofDPn78OEFFRYXm5ubGgcPhBY6OjpkXL17kzczMJOvq6mIFAgGgoF40Gs3Uzs7OlMlkxv/8+ZOxvr7uDIfDgyorKwv27t2L8vT0rIiLiwu+cuWKnZGRESI5OTn20aNHOa9evYJ8/frVUEFBoaiystL42bNnXBAIRE9OTq6wtLSkR0REyA8fPuwIQiAQfpOTk+4wGMxrenoa5u/vT8/Ly0NYWVnxdXV1/WEwGM7AwMCxsbHRr62tzYJOp3PhcHjS3r17SVwulzwzM0MbGhpCDA0NBd64caNidXW1BAQCleDx+FQvLy9PwH2eO3cOZmxs7EAgEPK0tbXT8/PzkZubmwloNBqtp6dnKpFIEo2Nja1sbW1Zhw8fRqLR6CypVGohl8sbMjMzTR8+fMhISkrSV1BQoMHhcPuMjIwGBAJh8OjRI3NAyCjHjx+ny+VyRxcXl7yWlpYEqVQKtre3B9+9ezfWxsaGPTc3F/37778nUKlUe8CbnD9/njYyMsIzMDCoYbPZ1d3d3VhXV9eawMBADgKBEO/YsaPi6dOnYiQSaRcfHx+rpKQEdXFxYTY2NsZBIBD7v//+Ozo8PDxxbW0t+f379xY7duxIkMlk8sLCQoiDgwOqra0tVCQShZqbm1NWVlYCvb29UTk5OTQCgaCvqalJuXHjRlJPTw9fQUEhGqSrq+tAp9Ptvnz5ArxVCIlEkp86dcp2bGwsKiUlJUcoFNJ37doVSSKR3Gtra+kHDx4E/E7yq1evbE1MTKyXl5eFv/32m6GFhQX1xIkThfX19YDaure0tJh3d3dDaTQawsDAIPHy5cvRDAajQVFRsaCoqMg5NTU1YdeuXYF//fUXysbGxq+npyf64MGDzhYWFuaDg4P609PTiSgUqk4qlTbw+Xy/PXv2ZH/79k308uVLexcXF0szMzPT4OBgHigwMDAaOP7Z2dnCsrKyhpycnLO7du1yW15edjxz5gwViUTyAaGKiopiA+Pj6OjI5XK5gS4uLuypqSkEhUIBAys2KSkJMT8/bzU3NxfW3d3NQqPRJKFQGKOgoOB64MABt19//bUoKiqqoqioKE0oFIZAIBB6SkqKrZKSEr62tra8srJSnp2dHRoeHp4zPz8v+fTpUzqBQJCOjY0xKRRKZX5+vlNlZSVrcnKyXFFR0fvmzZuAfakCYbFY5zdv3pRisVgDOzs75KVLl4y/ffsm4/F4VltbW2EvXrxo0NDQKGltbU08f/48YXt7m7Vr166s+vp6S319fX1vb+9ANptddebMGSCICGNjY81VVVVDtbS0bB89esTKz8/3OnfuHN7KyioQBALlsdlst9HRUfeJiYnk48ePU1VVVWtpNFoYDAZzlsvl4Ww2O+nx48ekiYmJXCQSmTA1NWVFp9Pd0Wi0wNXVVTQ+Pi6vqamR7Nixg7e+vp4DMjc3B29vb0Nqa2sDrl+/Ll9eXhZ7eHiwh4aG3KRSKd7W1tZHLpebxcfHM6FQqLuGhkaonp4eUktLK7G5ubnyn3/+SSwrK/Pr7OxkPHr0qNjNzc3Fz8+P2NLSQrt//77zyMhI9qtXr/Bv376VANrx8+dPMgaDQbi4uJA3NjZSh4eHPUNDQwn9/f3c+/fv21VUVNQ5ODjEVlVVJff09KCkUmmhl5cXncViYeFweK6Xl1dsY2Nj+dmzZ321tbU9QYuLi5YoFMrk1q1bbrGxsX7Ly8vI27dvg3///XfJ169fgVSUPjk5GUShUAAxq66rq6PU19fbd3R0AL4lCAKBhL99+zZ0YWFBvLi4aDY/Px9TVFQU7+zsnAWHw6vOnTtHhkAgXpWVlX4MBkPu4+MjtbS0BDBK7a5du4je3t7uwPYDLndjYyPs3r17MLlcbqSoqFgKAoEE+fn5wsrKykgXF5dawNXevXsX6urqKr1161Z6U1NTAujChQuyjIyMpPfv33uura3hJyYmolRUVDgQCCRRUVGxYnl52VVHR8fxxYsXFgcOHCjd3NyMPnHiROjm5iZETU3NaWFhIXphYaFAKpV6Dw4OhoSEhJj+73//Y6WmpoojIyNDlJSUzDo7O/Genp4EPp9fYG1tXb+1tZWxb98+eywWm1deXo548OBBlJubWzUYDLa9c+eObV1dHXLnzp3ckZGR4LS0NIe5ubkomUwWaWVlhWEymeCNjQ2HGzdumPB4vAYQEomsMTExEQoEAlRmZmYDgUDwV1JSKty5cycBBoPF3Lhxw62mpsYrPT0d2d7ezkej0SElJSXppaWltMHBQW8CgcDB4/H4pqamuubmZvyPHz+49+7dQ+3bty/k0qVL+pOTk9jZ2dn6pqameDQajb906RI4OTkZe/nyZQkEAuELBAI3IF/U19fbDQ4OMtPS0ggmJibg7u5u6suXL3lFRUVlGAymWlVVNVdXVzf37du3rj4+PoDlsWKz2VSQtrY2SyqVktbX131Onz5dTiQSJR8+fEg7ceJEMuCPOjs74f7+/lAAZOXm5qYNDQ0lqaurC44cOVICgUDgQEgRCATQ9vZ2EofDqQgJCSGvr6+nFBUVSRMSEmLz8/NLv3//7nrx4sWS+Ph4CZfLrZHL5VUKCgpYMBhMBYzj06dP7aFQqERZWTn25s2bsra2tjyhUBjc2dnpT6fTE9ra2gxzc3Ot0Gi0cHFxEd7W1lbk4uLCe/PmDQNUXFwcyOVybX755ZcGiUQiHR8fT2praxP09fX5mZqaJvj7+9ePj4/7pqamBsFgsLA9e/bEXbp0qdrd3d1henqaFRYWBjxk0tevX4V//PFHBA6Hw2RmZlq+evXKqqamJnJ+ft5eXV1d/PXrV2RnZ6expaWlAXC5W1paPC5fvmyNw+Fif/vtN9utrS1ubGxsOY/Hi3n37p3P58+frQCtgEKhHkVFRfbz8/M5Fy5cEFRUVLgHBAQQUCiUqZubWx0IBoMB8c363bt3UH19fe7Tp09jsrOzI8VisdjQ0BD27NkzA2VlZScPD4+YjIwMkaGhYUNjYyNiaWkpCDgJCoXCWFhYgISHh3PDwsKSKRQKWkdHB/X7778zyGSy2bFjxySPHj2qAEJJQEBAWWhoaMKvv/5aBRg8Go2GNTc3T25sbHRvbm7mHjx4UPzo0aNyW1tbjpWVlcDT01Oio6PD8/DwILa3t/ucOHEC+dtvv+H27dtH3Lt3r6murm45kAcqQkNDvYRCYQIej2empKTE1dXVpSwuLobr6+sz0tLS6gH6hkajKxEIBN/Y2JhAo9GcmExm7PPnz13AYHDluXPniNvb23gsFkuPioqyTU5Ohi0tLeG9vb1jZ2Zm4ohEouv09DR7Y2MjSFdX10RZWTmst7eXQaPRpNPT05h3797JV1dXeVQqNba8vDzY0NCw6OPHjyg+n18EWJ2xsbHSjo4ObG9vL21+fh5IhJKFhQUkILygxsZGiJeXF08mk1Xo6OjoczgcfQwG45uRkWEkEolycTgcp6amhtnQ0MBWVlbmqKqqoktLSz2UlJSCmpubYR8/fnTp7u4uADAgh8OpVFJSAsbCYt++fV7379+PEYvFJq2trbyxsTEgdUXQ6fTUx48fM1ZWVsgtLS2EsrIyYFEAWJOgrq7ulZWVZZmYmFiDQCCioqKi3FRVVYlXrlypRSAQ2R8+fND39PQsf/r0aa6/v39UQECAC4jJZLoKBALRzZs3/ZqbmxEA0+zr67Nua2tzrqmpqbp161Yul8s1qK6uTujt7a2fm5vjM5lMe4lEEiiVSn0iIyOtPn36lAuFQiskEklAdXW13cTEBDBWoSgUyolCoWQeP37cYXBwkFNQUGAdFRVV/fLlS+GHDx/qxsfHq1paWqyfPHlCz8zMDANibEpKSmZ7e3tsV1cXX1tb28zV1TWuqKiokM/nC968eZO9e/fustu3bwdhMJgYTU1NQ5CiomIYk8nEPX/+PAqNRgOBBWxoaGi7srJiX1ZWxtHT0wP4J7W7uzt0586dqGvXrlH+/fdfcFJSkvzevXs+Q0ND9tHR0eCTJ09m/vLLL+T+/v5CIyOjsujoaJ+4uLhIwK6Pj4+7b25umjg6OkZkZ2enubu7G9fV1WUHBwcTJycn616/fl3S19dHjYiIiNTT05PB4XAoi8VKzM3NZf/555+JT548sfL19SVhMJjioaEhmJWVlXTnzp1OAwMDbqDIyEg8EBHfvHkj19TULHV0dHQDEGNqaioUKByUlZUhgO318/Pz+PDhA5hMJleVlJTkstlsQUlJiU9JSQnZ1tZWYmJiIgAoGx6PD5JIJK5kMhkiFAoZFRUV1b6+vqZDQ0Ol5eXlzrdu3XJZW1tLe/36tZ2enp7/1NRUTH5+Pqu3tzd1586d3r/++qtkcnIyg8PhUNFodPGff/7JJpPJaAKBEJKXl0e2tLREnjt3zjomJsZtbW1NH3Ty5Mm0Fy9e1AKenU6nVxkbG8tBIJBRcnJyvFQqNTx8+LCIyWTmJyQklNTW1vqrqKiQANi0sbFhdfjw4apv376V+Pr6xoNAIGpDQwN/ZmYGEDXX+/fvA9mX0tnZCaBGq/fv3yOkUikQdKovXLhAvXLlSva+ffvgAoGAee/evcDU1NSS3bt3h/B4vLIjR47kampq2qyurgqzs7MTJRJJxKFDh852dnYCpi94YGAA4+vrm+3o6BgDMjIy8vr+/btgeHgYamVlZQyFQglHjhyJKigoqJ2dnY0DtktFRQXq6tWrZc3NzaixsbHCO3fuGC8sLBhpampmisXiYA0NjZQPHz4Qnz17hrKysqIMDw+HZWRkWBYXF2MdHR1h09PTzkgkkojFYlOxWCxGR0cHwIo4QL1lMhlCLpefDQoKaqitrYWqqKiwYmNjjdrb2xkIBCKBzWYblZaWlnd0dABUDqDUHjweD2djYyO+evVqIUgkEp3d2tpyCggISG1tbS0sLCysffr0KUCdQyMiIgr/+OMPXzKZHAiBQMCJiYlUDAZjTSQSw318fESVlZVIKpUKHR0dtfzx44e+g4MD0t7evuzQoUN+2dnZfAaDEfrlyxcbFouVMTo62iASiQpAIJAbFArlhoeHAxg+7MuXL4ArT+zs7ExbW1vLf/78uT6QtVVUVKzOnDkjdnFxSYqLi8v4+fMnU1lZ2c7LyytJJpMVTUxMGISEhESC+vv7sxUUFNgzMzOAhWD6+PiIT548mb2ysgLn8/lpIyMjWT09PVGrq6v8/fv3B+vp6XkCheDi4qI10ODs3r27/Ndff2UBVG1wcNCmvb3dcmZmxkdHR0fg7u5e8PbtW5JcLheoqqpaA/XT9PQ0+tmzZ9Y3btyQHT58OOnEiRM+HR0dcG1tbRmLxRLTaLQEOByuj8Vizfz9/RNqa2txbm5u3vfv349ITk6O9PPzk9JoNCARivh8fibIxsaGkJmZGXTq1CkyHo9PFovFQNMSSSQSPfX19al6enqxly9f9sPhcJR79+4lcblchwcPHjiWlpaakslkgydPnngsLCwAl07U399v1t7e7gdALJlMFnXs2LEqZWVlekBAgCkQQjAYjDcYDHZ69uwZ9fHjx17d3d2w1tbWomvXrgEKi3z79q3lzp07LT5//hwXHBwMc3JyYo6OjsqLiopSIiIiGDAYzDgxMdH0wIED9Tdv3sy2s7MrBRGJRI8nT57wuFwu38HBgcnlchMmJydZSkpKrp2dnZFxcXHMo0ePooHezNnZOW55ebl+bW2NcPr0acKLFy/Ep06doj958oR679693MDAQLSdnR1ZLpdzCwsLvVdXV50Ao9jY2Fivo6MT2dbW5pSfn5/R1NTEgUKhcLFYHLG0tBTGYDBIgFVRVVUN2r17NyYnJwf4w5EPHjyQCIXCcgB5Xr582YhMJpcUFRWVWFhYmFVXVzdAoVA86MuXLwElJSXBx44di6iurg5VVlaOzMrKIiQmJiKVlZWTX7x4gauqqiorLy/ndHV1uZmbmxPOnj2r39/f7zE1NeXk6OiIamxsBPa41/z8fEVycrKzh4dHtLW1tcvc3Fwqm80GAn/d5uYm+NChQ6VUKjWgr6/P6MyZM8V8Pt/OzMws2MLCQiQQCGg9PT28ly9fyhAIRFBnZ6ff+fPnjcbHx5GOjo7eKioqaKDk+/nzZ52urm5VX1+fhUgkagDl5eVFVlZW1lZUVHgSCISE//3vf9lIJBK9traGYDAYERcuXMDKZDI/EomUWVtbSxKLxVhLS0uujY0NmMPhZL1+/Tpseno6SigUArHTOD09HTsyMgK5ePGi/tOnT91WV1dT09PTPZycnEpCQkLq8Xg8LTU1NWJ+fj4diJA4HE7+/ft3iI2NjUtAQABnZGQEefr0aUNdXV0EnU6neXh4UP/66y8noPlRVVWNHh4e9u7p6aHMzs6GDA0NOYMGBweNjh8/7tHb2xs6NTVlm5mZaQWQYCsrq1QajYYDaid9ff24iYkJt4SEhKKxsTFnwGlqaGiYXGy4syEAAANaSURBVLt2zWZmZibox48fRBKJhM3Ly0tsbGyM2dzcRFVUVBTcuXOnZmVlxcXJyckIj8fbd3V1Acw/PDExEUGlUo2/fPkS9+nTJ0pra2v94cOHU65fvx4tEAi8fXx8Sn18fOjXr1/PACbE2NgYHhAQQCGTyVlYLJasrq5uhMViGQ8ePDAANTc3px09etRw586dtmtra1VcLjcdoAxHjx5lh4eHw2/cuJESGBjoA4fDvfT09P7/U4OWlhZXgFgPDw8XZmZmhn769CmisLDQ+vPnzyGrq6thAHdJSkoK4PF40Twej9Hc3Az0ZyUAjmEymYSlpaUMsVhsbmpqanTkyJHw4OBgO01NTY8///wz2NXV1XF9fb3B3t7e5OLFi5LCwkKz2NhY/LVr1wyHhob8TUxMSMvLy3gajRago6NjCdLS0gIuD4RIJAJ3IP/QoUNAFo2pqakxTUhIMIbD4alKSkoA88l1d3d3NzIyslxcXCTb29sXnT59GqDRXu3t7fbW1tY5mZmZtdvb29jnz59bAmMVHBxMS09Pj4FAIMyEhATrc+fOlW1sbBQEBAQEzMzMnAWEqbS01Kuvr69m9+7dkGPHjlH7+/vzNTU1c7S0tOKAOEsgEOwRCIT10NBQMiBcP378qLt161ZkVVVVRlRUFB20vr7uvrGxwQb6rsDAQNTHjx9peXl5OVeuXJEuLS0Bsa0yICAg48OHD2GFhYXhz58/FzU1NdGB4k1dXZ1EJpMtl5eX4wYHByMOHjwoA5jonj17OEBOyM3NhR49ehR75cqVNDQaXbO5uRnu4OBAA956V1dX2Y8fP6itra0OEAikDAwGA7Su7uXLl45aWlqkqqqqkt7eXqAghK2trbkdPHjwLAAggJbnwIEDpqdPn7ZoaGhwA9Yo49SpU5Dp6WnHubk5ckVFhe/W1hbt5MmTQHMIjEJQT08Px8LCwml1dTXgyZMnNUQi0efo0aMOurq6wXw+n7Jv377qiYmJwDt37gANi2lgYGDd9evXGTk5OdiXL1/CGxsbgSbGpLy8nPnz50+XBw8ewAIDA+PV1NQsv3z5gtXR0XHZ3t520tbWtikoKPBWU1Or+uuvv0obGhpwgN8BVnBvby9qZGQkoKmpqcLf3z+publZ5OLigvo/JtsAIJ9XFW4AAAAASUVORK5CYII=";

const EQ_PALETTE = ["#10b981", "#34d399", "#facc15", "#f59e0b"];
const EQ_ANIMS = ["feq1", "feq2", "feq3"] as const;
const EQ_COLS = Array.from({ length: BAR_COUNT }, (_, i) => ({
  color: EQ_PALETTE[i % EQ_PALETTE.length],
  anim: EQ_ANIMS[i % EQ_ANIMS.length],
  duration: 2.2 + ((i * 0.37) % 1.6),
  delay: (i * 0.17) % 1.2,
}));

// Mirrors the CSS @keyframes exactly (apps/web/app/globals.css):
//   feq1 { 0%,100%: scaleY(.35); 50%: scaleY(1) }
//   feq2 { 0%,100%: scaleY(.55); 40%: scaleY(.9); 70%: scaleY(.4) }
//   feq3 { 0%,100%: scaleY(.75); 50%: scaleY(.28) }
const EQ_KEYFRAMES: Record<(typeof EQ_ANIMS)[number], { at: number; v: number }[]> = {
  feq1: [{ at: 0, v: 0.35 }, { at: 0.5, v: 1 }, { at: 1, v: 0.35 }],
  feq2: [{ at: 0, v: 0.55 }, { at: 0.4, v: 0.9 }, { at: 0.7, v: 0.4 }, { at: 1, v: 0.55 }],
  feq3: [{ at: 0, v: 0.75 }, { at: 0.5, v: 0.28 }, { at: 1, v: 0.75 }],
};

function runBarLoop(value: Animated.Value, anim: (typeof EQ_ANIMS)[number], durationSec: number, delaySec: number) {
  const frames = EQ_KEYFRAMES[anim];
  const steps = [];
  for (let i = 1; i < frames.length; i++) {
    steps.push(
      Animated.timing(value, {
        toValue: frames[i].v,
        duration: (frames[i].at - frames[i - 1].at) * durationSec * 1000,
        useNativeDriver: true,
      }),
    );
  }
  value.setValue(frames[0].v);
  const loop = Animated.loop(Animated.sequence(steps));
  const timeoutId = setTimeout(() => loop.start(), delaySec * 1000);
  return () => {
    clearTimeout(timeoutId);
    loop.stop();
  };
}

function Bar({ color, anim, duration, delay }: { color: string; anim: (typeof EQ_ANIMS)[number]; duration: number; delay: number }) {
  const scale = useRef(new Animated.Value(EQ_KEYFRAMES[anim][0].v)).current;

  useEffect(() => runBarLoop(scale, anim, duration, delay), [scale, anim, duration, delay]);

  return (
    <Animated.View style={[styles.bar, { transform: [{ scaleY: scale }], transformOrigin: "bottom" }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="grad" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={color} stopOpacity={1} />
            <Stop offset="0.82" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#grad)" />
      </Svg>
    </Animated.View>
  );
}

// Web's AmbientAurora is static at opacity-[0.28] — no typing-reactive
// brightening — so this matches that exactly rather than inventing a new
// interaction. `active` is intentionally unused here (kept so callers don't
// need to change) — the wave never changes with typing on web.
export function AmbientWave(_props: { active?: boolean }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.wrap, styles.barsRow, { opacity: 0.28, filter: [{ blur: MOBILE_BLUR }] as any }]}>
        {EQ_COLS.map((col, i) => (
          <Bar key={i} color={col.color} anim={col.anim} duration={col.duration} delay={col.delay} />
        ))}
      </View>
      <Image source={{ uri: NOISE_DATA_URI }} resizeMode="repeat" style={[styles.wrap, styles.noise]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: "-14%", height: "68%" },
  barsRow: { flexDirection: "row", alignItems: "flex-end", gap: BAR_GAP },
  bar: { flex: 1, height: "100%" },
  noise: { opacity: 0.05 },
});
