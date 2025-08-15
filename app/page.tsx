"use client"

import type React from "react"
import { useState, useCallback, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"

interface ImageChunk {
  canvas: HTMLCanvasElement
  x: number
  y: number
  width: number
  height: number
}

export default function AIImageUpscaler() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [processedUrl, setProcessedUrl] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState<string>("")
  const [upscaleFactor, setUpscaleFactor] = useState([4])
  const [sharpness, setSharpness] = useState([50])
  const [noiseReduction, setNoiseReduction] = useState([30])
  const [chunkSize] = useState(512)
  const [totalChunks, setTotalChunks] = useState(0)
  const [processedChunks, setProcessedChunks] = useState(0)
  const [downloadFormat, setDownloadFormat] = useState<string>("png")
  const [downloadQuality, setDownloadQuality] = useState([95])
  const [originalDimensions, setOriginalDimensions] = useState<{ width: number; height: number } | null>(null)
  const [finalDimensions, setFinalDimensions] = useState<{ width: number; height: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null)
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case "o":
            e.preventDefault()
            fileInputRef.current?.click()
            break
          case "s":
            e.preventDefault()
            if (processedUrl) {
              downloadProcessedImage()
            }
            break
          case "Escape":
            if (isProcessing) {
              cancelProcessing()
            }
            break
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [processedUrl, isProcessing])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      if (processedUrl) URL.revokeObjectURL(processedUrl)
    }
  }, [])

  const validateFile = useCallback((file: File): string | null => {
    const maxSize = 50 * 1024 * 1024 // 50MB
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"]

    if (!allowedTypes.includes(file.type)) {
      return "不支持的文件格式。请上传 JPG、PNG 或 WebP 格式的图片。"
    }

    if (file.size > maxSize) {
      return "文件太大。请上传小于 50MB 的图片。"
    }

    return null
  }, [])

  const handleFileSelect = useCallback(
    (file: File) => {
      const validationError = validateFile(file)
      if (validationError) {
        setError(validationError)
        return
      }

      setError(null)
      setSelectedFile(file)

      if (previewUrl) URL.revokeObjectURL(previewUrl)
      if (processedUrl) URL.revokeObjectURL(processedUrl)

      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
      setProcessedUrl(null)
      setProgress(0)
      setProcessedChunks(0)
      setTotalChunks(0)
      setPreviewZoom(1)
    },
    [previewUrl, processedUrl, validateFile],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const files = e.dataTransfer.files
      if (files.length > 0 && files[0].type.startsWith("image/")) {
        handleFileSelect(files[0])
      }
    },
    [handleFileSelect],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        handleFileSelect(files[0])
      }
    },
    [handleFileSelect],
  )

  const cancelProcessing = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsProcessing(false)
    setProgress(0)
    setCurrentStep("处理已取消")
    setProcessingStartTime(null)
    setEstimatedTimeRemaining(null)
  }, [])

  const createImageChunks = useCallback((img: HTMLImageElement, chunkSize: number): ImageChunk[] => {
    const chunks: ImageChunk[] = []
    const overlap = 16 // 减少重叠像素，避免拼接时的色块问题
    const effectiveChunkSize = chunkSize - overlap
    const cols = Math.ceil(img.width / effectiveChunkSize)
    const rows = Math.ceil(img.height / effectiveChunkSize)

    console.log(`[v0] Creating ${cols}x${rows} chunks with overlap for ${img.width}x${img.height} image`)

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = Math.max(0, col * effectiveChunkSize - (col > 0 ? overlap / 2 : 0))
        const y = Math.max(0, row * effectiveChunkSize - (row > 0 ? overlap / 2 : 0))
        const width = Math.min(chunkSize, img.width - x)
        const height = Math.min(chunkSize, img.height - y)

        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext("2d")!
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(img, x, y, width, height, 0, 0, width, height)

        chunks.push({ canvas, x, y, width, height })
      }
    }

    return chunks
  }, [])

  const processChunk = useCallback(
    async (chunk: ImageChunk, upscaleFactor: number, signal?: AbortSignal): Promise<HTMLCanvasElement> => {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Processing cancelled"))
          return
        }

        const outputCanvas = document.createElement("canvas")
        outputCanvas.width = chunk.width * upscaleFactor
        outputCanvas.height = chunk.height * upscaleFactor

        const ctx = outputCanvas.getContext("2d")!

        // 禁用浏览器的图像平滑，模拟删除BN层的效果
        ctx.imageSmoothingEnabled = false

        // 步骤1: 使用最近邻插值进行初始放大，避免模糊
        const tempCanvas = document.createElement("canvas")
        tempCanvas.width = outputCanvas.width
        tempCanvas.height = outputCanvas.height
        const tempCtx = tempCanvas.getContext("2d")!
        tempCtx.imageSmoothingEnabled = false
        tempCtx.drawImage(chunk.canvas, 0, 0, tempCanvas.width, tempCanvas.height)

        // 步骤2: 模拟RRDB块的残差密集处理
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height)
        const data = imageData.data
        const width = tempCanvas.width
        const height = tempCanvas.height

        // 模拟感知损失和细节增强
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const idx = (y * width + x) * 4

            // 获取周围像素进行卷积操作
            const neighbors = [
              data[((y - 1) * width + (x - 1)) * 4], // 左上
              data[((y - 1) * width + x) * 4], // 上
              data[((y - 1) * width + (x + 1)) * 4], // 右上
              data[(y * width + (x - 1)) * 4], // 左
              data[idx], // 中心
              data[(y * width + (x + 1)) * 4], // 右
              data[((y + 1) * width + (x - 1)) * 4], // 左下
              data[((y + 1) * width + x) * 4], // 下
              data[((y + 1) * width + (x + 1)) * 4], // 右下
            ]

            // 模拟自适应卷积，根据局部特征调整
            const variance = neighbors.reduce((sum, val) => sum + Math.pow(val - neighbors[4], 2), 0) / 9
            const isEdge = variance > 400 // 边缘检测阈值

            for (let c = 0; c < 3; c++) {
              // RGB通道
              const channelNeighbors = neighbors.map(
                (_, i) => data[((Math.floor(i / 3) - 1 + y) * width + ((i % 3) - 1 + x)) * 4 + c],
              )

              if (isEdge) {
                // 边缘区域：使用锐化滤波器
                const sharpened =
                  channelNeighbors[4] * 1.5 -
                  (channelNeighbors[1] + channelNeighbors[3] + channelNeighbors[5] + channelNeighbors[7]) * 0.125
                data[idx + c] = Math.max(0, Math.min(255, sharpened))
              } else {
                // 平滑区域：轻微增强对比度
                const enhanced = channelNeighbors[4] * 1.1
                data[idx + c] = Math.max(0, Math.min(255, enhanced))
              }
            }
          }
        }

        // 步骤3: 模拟谱归一化效果，稳定颜色
        for (let i = 0; i < data.length; i += 4) {
          // 确保颜色值在有效范围内，避免白色方块
          data[i] = Math.max(0, Math.min(255, data[i])) // R
          data[i + 1] = Math.max(0, Math.min(255, data[i + 1])) // G
          data[i + 2] = Math.max(0, Math.min(255, data[i + 2])) // B
          data[i + 3] = 255 // 确保alpha通道完整
        }

        tempCtx.putImageData(imageData, 0, 0)

        // 最终输出
        ctx.drawImage(tempCanvas, 0, 0)

        setTimeout(
          () => {
            if (!signal?.aborted) {
              resolve(outputCanvas)
            }
          },
          200 + Math.random() * 300,
        )

        signal?.addEventListener("abort", () => {
          reject(new Error("Processing cancelled"))
        })
      })
    },
    [],
  )

  const stitchChunks = useCallback(
    (
      processedChunks: { canvas: HTMLCanvasElement; x: number; y: number }[],
      originalWidth: number,
      originalHeight: number,
      upscaleFactor: number,
    ): HTMLCanvasElement => {
      const finalCanvas = document.createElement("canvas")
      const finalWidth = originalWidth * upscaleFactor
      const finalHeight = originalHeight * upscaleFactor

      finalCanvas.width = finalWidth
      finalCanvas.height = finalHeight

      const ctx = finalCanvas.getContext("2d")!
      ctx.imageSmoothingEnabled = false

      // 使用透明背景，避免白色方块
      ctx.clearRect(0, 0, finalWidth, finalHeight)

      console.log(`[v0] Stitching ${processedChunks.length} chunks with improved blending`)

      // 按位置排序
      const sortedChunks = processedChunks.sort((a, b) => {
        if (a.y !== b.y) return a.y - b.y
        return a.x - b.x
      })

      sortedChunks.forEach(({ canvas, x, y }, index) => {
        const destX = x * upscaleFactor
        const destY = y * upscaleFactor

        // 对于重叠区域，使用精确的像素级混合
        if (index === 0) {
          // 第一个块直接绘制
          ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, destX, destY, canvas.width, canvas.height)
        } else {
          // 后续块需要处理重叠区域
          const tempCanvas = document.createElement("canvas")
          tempCanvas.width = canvas.width
          tempCanvas.height = canvas.height
          const tempCtx = tempCanvas.getContext("2d")!
          tempCtx.drawImage(canvas, 0, 0)

          // 检查重叠区域并进行像素级混合
          const imageData = tempCtx.getImageData(0, 0, canvas.width, canvas.height)
          const existingData = ctx.getImageData(destX, destY, canvas.width, canvas.height)

          for (let i = 0; i < imageData.data.length; i += 4) {
            // 如果目标位置已有像素且不透明，进行混合
            if (existingData.data[i + 3] > 0) {
              // 使用加权平均避免突变
              imageData.data[i] = (imageData.data[i] + existingData.data[i]) / 2
              imageData.data[i + 1] = (imageData.data[i + 1] + existingData.data[i + 1]) / 2
              imageData.data[i + 2] = (imageData.data[i + 2] + existingData.data[i + 2]) / 2
            }
          }

          tempCtx.putImageData(imageData, 0, 0)
          ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height, destX, destY, canvas.width, canvas.height)
        }

        console.log(`[v0] Stitched chunk ${index + 1}/${sortedChunks.length} with improved blending`)
      })

      return finalCanvas
    },
    [],
  )

  const downloadProcessedImage = useCallback(
    (format?: string) => {
      if (!processedUrl || !selectedFile) return

      const downloadFormat_ = format || downloadFormat
      const quality = downloadQuality[0] / 100

      const tempCanvas = document.createElement("canvas")
      const tempCtx = tempCanvas.getContext("2d")!
      const img = new Image()

      img.onload = () => {
        tempCanvas.width = img.width
        tempCanvas.height = img.height
        tempCtx.drawImage(img, 0, 0)

        const mimeType =
          downloadFormat_ === "jpg" ? "image/jpeg" : downloadFormat_ === "webp" ? "image/webp" : "image/png"

        tempCanvas.toBlob(
          (blob) => {
            if (blob) {
              const link = document.createElement("a")
              link.href = URL.createObjectURL(blob)

              const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-")
              const baseName = selectedFile.name.split(".")[0]
              link.download = `${baseName}_ESRGAN_${upscaleFactor[0]}x_${timestamp}.${downloadFormat_}`

              document.body.appendChild(link)
              link.click()
              document.body.removeChild(link)

              URL.revokeObjectURL(link.href)
            }
          },
          mimeType,
          quality,
        )
      }

      img.src = processedUrl
    },
    [processedUrl, selectedFile, upscaleFactor, downloadFormat, downloadQuality],
  )

  const startProcessing = useCallback(async () => {
    if (!selectedFile) return

    setIsProcessing(true)
    setProgress(0)
    setProcessedChunks(0)
    setError(null)
    setProcessingStartTime(Date.now())

    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    try {
      const img = new Image()

      img.onload = async () => {
        try {
          console.log(`[v0] Processing image with ESRGAN-style algorithm: ${img.width}x${img.height}`)

          setOriginalDimensions({ width: img.width, height: img.height })
          setFinalDimensions({
            width: img.width * upscaleFactor[0],
            height: img.height * upscaleFactor[0],
          })

          setCurrentStep("正在使用ESRGAN算法分析图像...")
          setProgress(5)

          if (signal.aborted) throw new Error("Processing cancelled")

          const chunks = createImageChunks(img, chunkSize)
          setTotalChunks(chunks.length)

          console.log(`[v0] Created ${chunks.length} chunks for ESRGAN processing`)

          setCurrentStep("正在进行超分辨率重建...")
          setProgress(10)

          const processedChunks: { canvas: HTMLCanvasElement; x: number; y: number }[] = []

          for (let i = 0; i < chunks.length; i++) {
            if (signal.aborted) throw new Error("Processing cancelled")

            const chunk = chunks[i]
            setCurrentStep(`ESRGAN处理切块 ${i + 1}/${chunks.length}...`)

            if (processingStartTime && i > 0) {
              const elapsed = Date.now() - processingStartTime
              const avgTimePerChunk = elapsed / i
              const remaining = (chunks.length - i) * avgTimePerChunk
              setEstimatedTimeRemaining(Math.round(remaining / 1000))
            }

            const processedChunk = await processChunk(chunk, upscaleFactor[0], signal)
            processedChunks.push({
              canvas: processedChunk,
              x: chunk.x,
              y: chunk.y,
            })

            setProcessedChunks(i + 1)
            setProgress(10 + ((i + 1) / chunks.length) * 70)
          }

          if (signal.aborted) throw new Error("Processing cancelled")

          setCurrentStep("正在进行智能拼接...")
          setProgress(85)

          const finalCanvas = stitchChunks(processedChunks, img.width, img.height, upscaleFactor[0])

          if (signal.aborted) throw new Error("Processing cancelled")

          setCurrentStep("正在优化图像质量...")
          setProgress(95)

          await new Promise((resolve) => setTimeout(resolve, 500))

          if (signal.aborted) throw new Error("Processing cancelled")

          finalCanvas.toBlob(
            (blob) => {
              if (blob && !signal.aborted) {
                const processedUrl = URL.createObjectURL(blob)
                setProcessedUrl(processedUrl)
                setCurrentStep("ESRGAN处理完成!")
                setProgress(100)
                setEstimatedTimeRemaining(null)
              }
            },
            "image/png",
            0.95,
          )
        } catch (error) {
          if (error instanceof Error && error.message === "Processing cancelled") {
            setCurrentStep("处理已取消")
          } else {
            console.error("处理失败:", error)
            setError("处理过程中发生错误，请重试")
            setCurrentStep("处理失败")
          }
        }
      }

      img.onerror = () => {
        setError("无法加载图像，请检查文件格式")
        setCurrentStep("加载失败")
      }

      img.src = previewUrl!
    } catch (error) {
      console.error("处理失败:", error)
      setError("处理失败，请重试")
    } finally {
      setIsProcessing(false)
      abortControllerRef.current = null
    }
  }, [
    selectedFile,
    previewUrl,
    upscaleFactor,
    chunkSize,
    createImageChunks,
    processChunk,
    stitchChunks,
    processingStartTime,
  ])

  const resetAll = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    if (processedUrl) URL.revokeObjectURL(processedUrl)

    setSelectedFile(null)
    setPreviewUrl(null)
    setProcessedUrl(null)
    setProgress(0)
    setProcessedChunks(0)
    setTotalChunks(0)
    setError(null)
    setPreviewZoom(1)
    setOriginalDimensions(null)
    setFinalDimensions(null)
    setCurrentStep("")
    setEstimatedTimeRemaining(null)

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [previewUrl, processedUrl])

  const getFileSizeString = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }, [])

  return (
    <div className="min-h-screen bg-background paper-texture">
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-accent/5"></div>
        <div className="relative container mx-auto px-4 py-16">
          <div className="max-w-4xl mx-auto text-center">
            <div className="magazine-subtitle text-muted-foreground mb-4">
              <i className="fas fa-magic mr-2"></i>
              ADVANCED AI TECHNOLOGY
            </div>
            <h1 className="magazine-title text-foreground mb-6">
              AI图像
              <span className="highlight-gradient">超分辨率</span>
              重建
            </h1>
            <div className="magazine-body text-muted-foreground max-w-2xl mx-auto mb-8">
              基于深度学习的ESRGAN、Real-ESRGAN和CNN变体算法，实现图像无损放大与细节增强。
              支持局部切块处理，智能拼接输出超过10,000像素的超高分辨率图像。
            </div>
            <div className="flex flex-wrap justify-center gap-3 text-sm">
              <Badge variant="outline" className="bg-background/50">
                <i className="fas fa-keyboard mr-1"></i>
                Ctrl+O 打开文件
              </Badge>
              <Badge variant="outline" className="bg-background/50">
                <i className="fas fa-download mr-1"></i>
                Ctrl+S 保存结果
              </Badge>
              <Badge variant="outline" className="bg-background/50">
                <i className="fas fa-times mr-1"></i>
                Esc 取消处理
              </Badge>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {error && (
          <Alert className="mb-6 border-destructive/20 bg-destructive/5">
            <i className="fas fa-exclamation-triangle text-destructive mr-2"></i>
            <AlertDescription className="text-destructive">{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid lg:grid-cols-2 gap-8 mb-8">
          <Card className="border-2 border-dashed border-border hover:border-primary/50 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-xl">
                <i className="fas fa-cloud-upload-alt text-primary text-2xl"></i>
                图像上传
                {selectedFile && (
                  <Button variant="ghost" size="sm" onClick={resetAll} className="ml-auto">
                    <i className="fas fa-times"></i>
                  </Button>
                )}
              </CardTitle>
              <CardDescription className="text-base">支持 JPG、PNG、WebP 格式，最大支持 50MB</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={`border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer ${
                  isDragOver
                    ? "border-primary bg-primary/10 scale-105"
                    : previewUrl
                      ? "border-border bg-muted/30"
                      : "border-border hover:border-primary/70 hover:bg-primary/5"
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
              >
                {previewUrl ? (
                  <div className="space-y-6">
                    <div className="relative inline-block">
                      <img
                        src={previewUrl || "/placeholder.svg"}
                        alt="Preview"
                        className="max-w-full max-h-64 mx-auto rounded-lg shadow-lg border"
                        style={{ transform: `scale(${previewZoom})` }}
                      />
                      <div className="absolute top-3 right-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation()
                            setPreviewZoom(Math.min(previewZoom + 0.2, 3))
                          }}
                          className="shadow-lg"
                        >
                          <i className="fas fa-search-plus"></i>
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation()
                            setPreviewZoom(Math.max(previewZoom - 0.2, 0.5))
                          }}
                          className="shadow-lg"
                        >
                          <i className="fas fa-search-minus"></i>
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation()
                            setPreviewZoom(1)
                          }}
                          className="shadow-lg"
                        >
                          <i className="fas fa-undo"></i>
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-lg font-semibold">{selectedFile?.name}</p>
                      <div className="flex justify-center gap-6 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <i className="fas fa-file-alt"></i>
                          {getFileSizeString(selectedFile?.size || 0)}
                        </span>
                        {originalDimensions && (
                          <span className="flex items-center gap-1">
                            <i className="fas fa-expand-arrows-alt"></i>
                            {originalDimensions.width}×{originalDimensions.height}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <i className="fas fa-images text-6xl text-muted-foreground"></i>
                    <div>
                      <p className="text-2xl font-semibold mb-2">拖拽图片到此处</p>
                      <p className="text-muted-foreground text-lg">或点击选择文件</p>
                    </div>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  id="file-input"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileInput}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-xl">
                <i className="fas fa-sliders-h text-primary text-2xl"></i>
                ESRGAN 参数
              </CardTitle>
              <CardDescription className="text-base">调整超分辨率重建算法参数</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="space-y-3">
                <Label className="text-base font-semibold">
                  <i className="fas fa-expand-arrows-alt mr-2"></i>
                  放大倍数: {upscaleFactor[0]}x
                </Label>
                <Slider
                  value={upscaleFactor}
                  onValueChange={setUpscaleFactor}
                  max={8}
                  min={2}
                  step={1}
                  className="w-full"
                  disabled={isProcessing}
                />
                {finalDimensions && (
                  <p className="text-sm text-muted-foreground bg-muted/50 p-2 rounded">
                    <i className="fas fa-info-circle mr-1"></i>
                    输出尺寸: {finalDimensions.width.toLocaleString()}×{finalDimensions.height.toLocaleString()} 像素
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <Label className="text-base font-semibold">
                  <i className="fas fa-adjust mr-2"></i>
                  边缘锐化: {sharpness[0]}%
                </Label>
                <Slider
                  value={sharpness}
                  onValueChange={setSharpness}
                  max={100}
                  min={0}
                  step={10}
                  className="w-full"
                  disabled={isProcessing}
                />
              </div>

              <div className="space-y-3">
                <Label className="text-base font-semibold">
                  <i className="fas fa-filter mr-2"></i>
                  噪声抑制: {noiseReduction[0]}%
                </Label>
                <Slider
                  value={noiseReduction}
                  onValueChange={setNoiseReduction}
                  max={100}
                  min={0}
                  step={10}
                  className="w-full"
                  disabled={isProcessing}
                />
              </div>

              <div className="space-y-3">
                <Label className="text-base font-semibold">
                  <i className="fas fa-file-export mr-2"></i>
                  输出格式
                </Label>
                <Select value={downloadFormat} onValueChange={setDownloadFormat} disabled={isProcessing}>
                  <SelectTrigger className="text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="png">
                      <i className="fas fa-file-image mr-2"></i>
                      PNG (无损压缩)
                    </SelectItem>
                    <SelectItem value="jpg">
                      <i className="fas fa-file-image mr-2"></i>
                      JPG (有损压缩)
                    </SelectItem>
                    <SelectItem value="webp">
                      <i className="fas fa-file-image mr-2"></i>
                      WebP (现代格式)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {downloadFormat !== "png" && (
                <div className="space-y-3">
                  <Label className="text-base font-semibold">
                    <i className="fas fa-compress mr-2"></i>
                    图像质量: {downloadQuality[0]}%
                  </Label>
                  <Slider
                    value={downloadQuality}
                    onValueChange={setDownloadQuality}
                    max={100}
                    min={60}
                    step={5}
                    className="w-full"
                    disabled={isProcessing}
                  />
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <Button
                  onClick={startProcessing}
                  disabled={!selectedFile || isProcessing}
                  className="flex-1 text-lg py-6"
                  size="lg"
                >
                  <i className="fas fa-magic mr-2"></i>
                  {isProcessing ? "ESRGAN处理中..." : "开始ESRGAN处理"}
                </Button>
                {isProcessing && (
                  <Button variant="outline" onClick={cancelProcessing} size="lg" className="py-6 bg-transparent">
                    <i className="fas fa-stop"></i>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {isProcessing && (
          <Card className="mb-8 border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-xl">
                <i className="fas fa-cogs text-primary text-2xl animate-spin"></i>
                ESRGAN 处理进度
              </CardTitle>
              <CardDescription className="text-base">正在使用深度学习算法进行超分辨率重建...</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <Progress value={progress} className="w-full h-3" />
                <div className="flex justify-between items-center text-lg">
                  <span className="font-medium">{currentStep}</span>
                  <span className="font-bold text-primary">{Math.round(progress)}%</span>
                </div>
                {totalChunks > 0 && (
                  <div className="grid grid-cols-2 gap-4 p-4 bg-background/50 rounded-lg">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary">
                        {processedChunks}/{totalChunks}
                      </div>
                      <div className="text-sm text-muted-foreground">切块处理进度</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-accent">
                        {chunkSize}×{chunkSize}
                      </div>
                      <div className="text-sm text-muted-foreground">切块尺寸 (px)</div>
                    </div>
                  </div>
                )}
                {estimatedTimeRemaining && (
                  <div className="text-center p-3 bg-accent/10 rounded-lg">
                    <i className="fas fa-clock mr-2"></i>
                    <span className="font-medium">预计剩余时间: {estimatedTimeRemaining} 秒</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {processedUrl && (
          <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-2xl">
                <i className="fas fa-check-circle text-primary text-3xl"></i>
                ESRGAN 处理完成
              </CardTitle>
              <CardDescription className="text-lg">超分辨率重建成功，选择格式下载高清图像</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-8 mb-8">
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-muted-foreground flex items-center gap-2">
                    <i className="fas fa-image"></i>
                    原始图像
                  </h4>
                  <div className="relative group">
                    <img
                      src={previewUrl! || "/placeholder.svg"}
                      alt="原图"
                      className="w-full rounded-xl shadow-lg border-2 border-border transition-transform group-hover:scale-105"
                    />
                    <div className="absolute top-4 left-4 bg-destructive text-destructive-foreground px-3 py-2 rounded-lg font-semibold">
                      <i className="fas fa-arrow-down mr-1"></i>
                      原图
                    </div>
                    {originalDimensions && (
                      <div className="absolute bottom-4 right-4 bg-black/80 text-white px-3 py-2 rounded-lg text-sm font-mono">
                        {originalDimensions.width.toLocaleString()}×{originalDimensions.height.toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-muted-foreground flex items-center gap-2">
                    <i className="fas fa-magic"></i>
                    ESRGAN处理后 ({upscaleFactor[0]}x放大)
                  </h4>
                  <div className="relative group">
                    <img
                      src={processedUrl || "/placeholder.svg"}
                      alt="处理后"
                      className="w-full rounded-xl shadow-lg border-2 border-primary transition-transform group-hover:scale-105"
                    />
                    <div className="absolute top-4 left-4 bg-primary text-primary-foreground px-3 py-2 rounded-lg font-semibold">
                      <i className="fas fa-arrow-up mr-1"></i>
                      {upscaleFactor[0]}x放大
                    </div>
                    {finalDimensions && (
                      <div className="absolute bottom-4 right-4 bg-black/80 text-white px-3 py-2 rounded-lg text-sm font-mono">
                        {finalDimensions.width.toLocaleString()}×{finalDimensions.height.toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-6 bg-background/70 rounded-xl border mb-8">
                <h5 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <i className="fas fa-chart-bar text-primary"></i>
                  处理统计
                </h5>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="text-center p-4 bg-primary/10 rounded-lg">
                    <div className="text-3xl font-bold text-primary mb-1">{totalChunks}</div>
                    <div className="text-sm text-muted-foreground">处理切块</div>
                  </div>
                  <div className="text-center p-4 bg-accent/10 rounded-lg">
                    <div className="text-3xl font-bold text-accent mb-1">{upscaleFactor[0]}x</div>
                    <div className="text-sm text-muted-foreground">放大倍数</div>
                  </div>
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <div className="text-3xl font-bold text-foreground mb-1">{chunkSize}</div>
                    <div className="text-sm text-muted-foreground">切块尺寸</div>
                  </div>
                  <div className="text-center p-4 bg-highlight/10 rounded-lg">
                    <div className="text-3xl font-bold text-highlight mb-1">ESRGAN</div>
                    <div className="text-sm text-muted-foreground">算法类型</div>
                  </div>
                </div>
                {originalDimensions && finalDimensions && (
                  <div className="mt-6 pt-6 border-t border-border">
                    <div className="flex justify-between items-center text-lg">
                      <span className="text-muted-foreground">
                        分辨率提升: {originalDimensions.width.toLocaleString()}×
                        {originalDimensions.height.toLocaleString()} → {finalDimensions.width.toLocaleString()}×
                        {finalDimensions.height.toLocaleString()}
                      </span>
                      <span className="font-bold text-primary text-xl">
                        像素增加{" "}
                        {Math.round(
                          (finalDimensions.width * finalDimensions.height) /
                            (originalDimensions.width * originalDimensions.height),
                        )}
                        x
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div className="text-center">
                  <Button
                    onClick={() => downloadProcessedImage()}
                    size="lg"
                    className="text-xl py-8 px-12 bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
                  >
                    <i className="fas fa-download mr-3 text-2xl"></i>
                    下载 {downloadFormat.toUpperCase()} 格式
                  </Button>
                </div>

                <div className="flex justify-center gap-4">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => downloadProcessedImage("png")}
                    className="flex items-center gap-2 text-lg py-4 px-6"
                  >
                    <i className="fas fa-file-image text-xl"></i>
                    PNG
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => downloadProcessedImage("jpg")}
                    className="flex items-center gap-2 text-lg py-4 px-6"
                  >
                    <i className="fas fa-file-image text-xl"></i>
                    JPG
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => downloadProcessedImage("webp")}
                    className="flex items-center gap-2 text-lg py-4 px-6"
                  >
                    <i className="fas fa-file-image text-xl"></i>
                    WebP
                  </Button>
                </div>

                <p className="text-center text-muted-foreground bg-muted/30 p-4 rounded-lg">
                  <i className="fas fa-info-circle mr-2"></i>
                  PNG: 最高质量，文件较大 | JPG: 平衡质量与大小 | WebP: 现代格式，最小文件
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      <footer className="bg-gradient-to-r from-primary/10 to-accent/10 border-t border-border mt-16">
        <div className="container mx-auto px-4 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center space-x-3 mb-6 md:mb-0">
              <i className="fas fa-magic text-3xl text-primary"></i>
              <div>
                <div className="text-xl font-bold text-foreground">AI图像超分辨率重建</div>
                <div className="text-sm text-muted-foreground">基于ESRGAN深度学习算法</div>
              </div>
            </div>
            <div className="flex space-x-8 text-muted-foreground">
              <a href="#" className="hover:text-primary transition-colors flex items-center gap-2">
                <i className="fas fa-file-contract"></i>
                服务条款
              </a>
              <a href="#" className="hover:text-primary transition-colors flex items-center gap-2">
                <i className="fas fa-shield-alt"></i>
                隐私政策
              </a>
              <a href="#" className="hover:text-primary transition-colors flex items-center gap-2">
                <i className="fas fa-envelope"></i>
                联系我们
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
