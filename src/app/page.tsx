"use client"
import { useState, useEffect, useRef } from "react"
import { PitchDetector } from "pitchy"
import { motion } from "framer-motion"
import Image from "next/image"

export default function Home() {
  const [pitch, setPitch] = useState<number | null>(null)
  const [isListening, setIsListening] = useState<boolean>(false)
  const [smoothPitch, setSmoothPitch] = useState<number | null>(null)
  const [displayedNote, setDisplayedNote] = useState<string>("A")
  const [gaugeValue, setGaugeValue] = useState<number>(50)
  const [status, setStatus] = useState<string>("Not Good")
  const [showSetting,setShowSetting] = useState(false)
  const [AlpabetForm, setFormat] = useState(true)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataArrayRef = useRef<Float32Array | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const targetPitchRef = useRef<number | null>(null)
  const lastNoteRef = useRef<string>("N/A")
  const noteUpdateTimeout = useRef<NodeJS.Timeout | null>(null)

  const smoothingDuration = 200

  const letterNoteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  const solfegeNoteNames = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"]

  const panelVariants = {
    hidden: { opacity: 0, scale: 0, y: -60 , x:-85 },
    visible: { opacity: 1, scale: 1, y: 0, x:0 ,transition: { duration: 0.3, ease: "easeOut" } },
  }
  const noteNames = AlpabetForm ? letterNoteNames : solfegeNoteNames

  const noteFrequencies = letterNoteNames.map((note, i) => ({
    note,
    frequency: 261.63 * Math.pow(2, i / 12), // Automatically calculates note frequencies
  }))

  useEffect(() => {
    return () => {
      if (audioContextRef.current) audioContextRef.current.close()
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  useEffect(() => {
    if (pitch !== null) {
      targetPitchRef.current = pitch
      if (smoothPitch === null) {
        setSmoothPitch(pitch)
      } else {
        smoothTransition()
      }
    }
  }, [pitch])

  useEffect(() => {
    if (smoothPitch !== null) {
      const { note, gauge, status } = getNoteAndCents(smoothPitch)
      const noteIndex = letterNoteNames.indexOf(note)
      const formattedNote = AlpabetForm ? note : solfegeNoteNames[noteIndex] || note

      if (formattedNote !== lastNoteRef.current) {
        if (noteUpdateTimeout.current) clearTimeout(noteUpdateTimeout.current)
        noteUpdateTimeout.current = setTimeout(() => {
          setDisplayedNote(formattedNote)
          setGaugeValue(gauge)
          setStatus(status)
          lastNoteRef.current = formattedNote
        }, 5)
      } else {
        setGaugeValue(gauge)
        setStatus(status)
      }
    }
  }, [smoothPitch, AlpabetForm])

  const smoothTransition = () => {
    const start = Date.now()
    const startPitch = smoothPitch || 0
    const targetPitch = targetPitchRef.current || 0
    const animate = () => {
      const elapsed = Date.now() - start
      const progress = Math.min(elapsed / smoothingDuration, 1)
      const interpolatedPitch = startPitch + (targetPitch - startPitch) * progress
      setSmoothPitch(interpolatedPitch)
      if (progress < 1) requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }

  const startPitchDetection = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const audioContext = new (window.AudioContext || window.AudioContext)()
      audioContextRef.current = audioContext
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      analyserRef.current = analyser
      const source = audioContext.createMediaStreamSource(stream)
      sourceRef.current = source
      source.connect(analyser)
      const bufferLength = analyser.frequencyBinCount
      dataArrayRef.current = new Float32Array(bufferLength)
      setIsListening(true)
      detectPitch()
    } catch (error) {
      console.error("Error accessing microphone:", error)
      alert("Error accessing microphone: " + (error as Error).message)
    }
  }

  const stopPitchDetection = () => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    if (sourceRef.current) sourceRef.current.disconnect()
    if (audioContextRef.current) audioContextRef.current.close()
    setIsListening(false)
    setPitch(null)
    setSmoothPitch(null)
    setDisplayedNote("A")
    setGaugeValue(50)
    setStatus("Not Good")
    lastNoteRef.current = "A"
  }

  const detectPitch = () => {
    const analyser = analyserRef.current
    const dataArray = dataArrayRef.current
    if (!analyser || !dataArray) return
    analyser.getFloatTimeDomainData(dataArray)
    let sum = 0
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i]
    }
    const rms = Math.sqrt(sum / dataArray.length)
    const threshold = 0.05
    if (rms < threshold) {
      setPitch(null)
    } else {
      const detector = PitchDetector.forFloat32Array(dataArray.length)
      const inputSampleRate = audioContextRef.current?.sampleRate || 44100
      const [detectedPitch, clarity] = detector.findPitch(dataArray, inputSampleRate)
      if (clarity > 0.9) {
        setPitch(detectedPitch)
      } else {
        setPitch(null)
      }
    }
    rafIdRef.current = requestAnimationFrame(detectPitch)
  }

  function getNoteAndCents(frequency: number) {
    if (frequency <= 0) return { note: "N/A", gauge: 50, status: "Not Good" }

    while (frequency < 250) frequency *= 2
    while (frequency > 500) frequency /= 2

    let closestNote = noteFrequencies[0]
    let minDiff = Math.abs(frequency - closestNote.frequency)
    for (let i = 1; i < noteFrequencies.length; i++) {
      const diff = Math.abs(frequency - noteFrequencies[i].frequency)
      if (diff < minDiff) {
        minDiff = diff
        closestNote = noteFrequencies[i]
      }
    }

    const differenceInCents = 1200 * Math.log2(frequency / closestNote.frequency)
    const clampedCents = Math.max(-50, Math.min(50, differenceInCents))
    const percent = ((clampedCents + 50) / 100) * 100

    const noteIndex = letterNoteNames.indexOf(closestNote.note)
    const formattedNote = AlpabetForm ? closestNote.note : solfegeNoteNames[noteIndex] || closestNote.note

    let statusText = "Not Good"
    if (Math.abs(differenceInCents) < 5) statusText = "Perfect"
    else if (Math.abs(differenceInCents) < 15) statusText = "Good"

    return { note: formattedNote, gauge: percent, status: statusText }
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen w-screen bg-gray-900 overflow-hidden">
  


<motion.div
    className="absolute w-[200px] h-[200px]  top-1/2"
    transition={{ }}     
    animate={{y : -200 ,rotate  : (gaugeValue - 50) * 1 }}>
      <div className="w-16 h-16"
           style={{  
            background : 'url(./index.svg)',
            backgroundRepeat : 'no-repeat',
            transform : " translateX(70px)"
          }}>
      </div>
  </motion.div>
      <div className="h-5/6 w-full absolute bg-gradient-to-t bottom-0 from-gray-900 z-0" />
      <div className="h-3/5 w-full absolute -bottom-32 bg-gradient-to-t from-teal-700 z-20" />
      <motion.div
        className="relative top-[120px]"
        animate={{
          rotate: -(180 / 6) * noteNames.indexOf(displayedNote.replace(/\d+/g, "")),
        }}
        transition={{ type: "spring", stiffness: 100, damping: 10 }}
      >
        <div className="flex items-center justify-center relative">
        {noteNames.map((note, index) => {
  const angle = (index / noteNames.length) * 360;
  const isActive = displayedNote.replace(/\d+/g, "") === (AlpabetForm ? letterNoteNames[index] : solfegeNoteNames[index]);

  return (
    <motion.div
      key={note}
      className={`absolute w-12 h-12 flex items-center justify-center 
        ${isActive ? "font-bold text-white" : "text-gray-500 text-sm"}
      `}
      animate={{
        transform: `rotate(${angle - 90}deg) translate(280px) rotate(${90}deg) ${isActive ? "scale(1.6)" : "scale(1)"}`
      }}
      transition={{ type: "spring", stiffness: 150, damping: 10 }}
    >
      {note}
    </motion.div>
  );
})}
        </div>
      </motion.div>

    <div className="z-50 flex flex-col items-center gap-1 ">
          {isListening?  
            <p
              className={`font-bold text-[10px] mt-5 self-center rounded-full pl-2 pr-2 pt-[1px] bg-opacity-20 ${
                status === "Perfect"
                  ? "text-green-400 bg-green-500"
                  : status === "Good"
                  ? "text-yellow-400 bg-yellow-600"
                  : "text-red-400 bg-red-600 "
              }`}>
                {status}
            </p>
          :  <p
              className="font-bold text-[10px] mt-5 self-center rounded-full pl-2 pr-2 pt-[1px] bg-opacity-20 text-green-400 bg-green-500">
                Ready
            </p>
          }

          <div className="w-screen h-7  flex justify-center translate-y-[100px]">
                  <div className="">

                    {Array.from({ length: 7 }).map((_, i) => {
                      const angle = 157.7 + (45 / 6) * i
                      return (
                        <div
                        key={i}
                        className={`absolute bg-white ${i==3? "w-[2px] h-3" : "w-[1px] h-2"} `} 
                        style={{
                          transform : `rotate(-${angle}deg) ${i==3 ?"translateY(268px)" : "translateY(260px)" }`, // Moves it outward from the center
                          transformOrigin : "center bottom", // Ensures rotation happens from the base
                        }}
                      />
                      )
                    })}            
                      </div>
                    </div>
                  
           <div className="-translate-y-3">
           <h1 className="text-4xl font-bold mb-3 text-white text-center">Tuner</h1>
                  
                  <div className="flex flex-col items-center gap-2 z-40">
                    {!isListening ? (
                      <button
                        onClick={startPitchDetection}
                        className="h-16 w-16 rounded-full bg-blue-600 font-semibold shadow-lg hover:bg-blue-700 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 text-white"
                      >
                        Start
                      </button>
                    ) : (
                      <button
                        onClick={stopPitchDetection}
                        className="h-16 w-16 rounded-full bg-red-600 text-white font-semibold shadow-lg hover:bg-red-700 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50"
                      >
                        Stop
                      </button>
                    )}
                    <p className="mt-2 text-center text-2xl text-gray-400">
                      <span className="font-bold text-3xl mb-3">{displayedNote}</span>
                      <br />
                      <span className="font-semibold text-gray-500 text-sm">
                        {smoothPitch ? smoothPitch.toFixed(2) : 0} Hz
                      </span>
                      <br />
                  
                    </p>
                   </div>
           </div>

      <motion.button transition={{ type: "spring", stiffness: 100, damping: 10 }} animate={{rotate: showSetting?90:0}} className="fixed top-5 left-5" onClick={() => setShowSetting(!showSetting)}>
        <Image src={'./setting.svg'} alt="setting" width={25} height={25} />
      </motion.button>

      <motion.div
        initial="hidden"
        animate={showSetting ? "visible" : "hidden"}
        variants={panelVariants}
        className="fixed top-14 left-5 w-60 text-white p-4 bg-gray-900  border-2 border-blue-400  rounded-xl shadow-lg flex flex-col gap-2"
      >

        
        <button
          onClick={() => setFormat(true)}
          className={`py-1 px-3  rounded-xl bg-gray-800 ${AlpabetForm ? "border-2 border-blue-400" : ""}`}
        >
          <p className={`text-sm font-bold ${AlpabetForm&&'text-blue-400'}`}>A B C</p>
        </button>

        <button
          onClick={() => setFormat(false)}
          className={`py-1 px-3  rounded-xl bg-gray-800 ${!AlpabetForm ? "border-2 border-blue-400" : ""}`}
        >
         <p className={`text-sm font-bold ${!AlpabetForm&&'text-blue-400'}`}> Do Re Mi</p>
        </button>

      </motion.div>

           <div className="fixed w-screen bottom-0 text-center">
            <p className="text-[10px] font-light font-sans text-cyan-200 opacity-65">Powerd by Shadi Alatwani</p>
           </div>
  </div>
      
  </div>
  )
}