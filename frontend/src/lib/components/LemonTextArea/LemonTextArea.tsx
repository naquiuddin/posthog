import './LemonTextArea.scss'
import React, { createRef, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import TextareaAutosize from 'react-textarea-autosize'
import { Tabs } from 'antd'
import { IconMarkdown, IconTools } from 'lib/components/icons'
import { TextContent } from 'lib/components/Cards/TextCard/TextCard'
import api from 'lib/api'
import { lemonToast } from 'lib/components/lemonToast'
import posthog from 'posthog-js'
import { LemonFileInput } from 'lib/components/LemonFileInput/LemonFileInput'
import { useValues } from 'kea'
import { preflightLogic } from 'scenes/PreflightCheck/preflightLogic'
import { Link } from 'lib/components/Link'
import { Tooltip } from 'lib/components/Tooltip'

export interface LemonTextAreaProps
    extends Pick<
        React.TextareaHTMLAttributes<HTMLTextAreaElement>,
        'onFocus' | 'onBlur' | 'maxLength' | 'autoFocus' | 'onKeyDown'
    > {
    id?: string
    value?: string
    defaultValue?: string
    placeholder?: string
    className?: string
    /** Whether input field is disabled */
    disabled?: boolean
    ref?: React.Ref<HTMLTextAreaElement>
    onChange?: (newValue: string) => void
    /** Callback called when Cmd + Enter (or Ctrl + Enter) is pressed.
     * This checks for Cmd/Ctrl, as opposed to LemonInput, to avoid blocking multi-line input. */
    onPressCmdEnter?: (newValue: string) => void
    minRows?: number
    maxRows?: number
    rows?: number
}

/** A `textarea` component for multi-line text. */
export const LemonTextArea = React.forwardRef<HTMLTextAreaElement, LemonTextAreaProps>(function _LemonTextArea(
    { className, onChange, onFocus, onBlur, onPressCmdEnter: onPressEnter, minRows = 3, onKeyDown, ...textProps },
    ref
): JSX.Element {
    const _ref = useRef<HTMLTextAreaElement | null>(null)
    const textRef = ref || _ref

    return (
        <TextareaAutosize
            minRows={minRows}
            ref={textRef}
            className={clsx('LemonTextArea', className)}
            onKeyDown={(e) => {
                if (onPressEnter && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    onPressEnter(textProps.value?.toString() ?? '')
                }

                onKeyDown?.(e)
            }}
            onChange={(event) => onChange?.(event.currentTarget.value ?? '')}
            {...textProps}
        />
    )
})

interface LemonTextMarkdownProps {
    'data-attr'?: string
    value: string
    onChange: (s: string) => void
}

export function LemonTextMarkdown({ value, onChange, ...editAreaProps }: LemonTextMarkdownProps): JSX.Element {
    const { objectStorageAvailable } = useValues(preflightLogic)

    const [uploading, setUploading] = useState(false)
    const [filesToUpload, setFilesToUpload] = useState<File[]>([])
    const dropRef = createRef<HTMLDivElement>()

    const textAreaRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        const uploadFiles = async (): Promise<void> => {
            if (filesToUpload.length === 0) {
                setUploading(false)
                return
            }

            try {
                setUploading(true)
                const formData = new FormData()
                formData.append('image', filesToUpload[0])
                const media = await api.media.upload(formData)
                onChange(value + `\n\n![${media.name}](${media.image_location})`)
                posthog.capture('markdown image uploaded', { name: media.name })
            } catch (error) {
                const errorDetail = (error as any).detail || 'unknown error'
                posthog.capture('markdown image upload failed', { error: errorDetail })
                lemonToast.error(`Error uploading image: ${errorDetail}`)
            } finally {
                setUploading(false)
                setFilesToUpload([])
            }
        }
        uploadFiles().catch(console.error)
    }, [filesToUpload])

    return (
        <Tabs>
            <Tabs.TabPane tab="Write" key="write-card" destroyInactiveTabPane={true}>
                <div ref={dropRef} className={clsx('LemonTextMarkdown flex flex-col p-2 space-y-1 rounded')}>
                    <LemonTextArea ref={textAreaRef} {...editAreaProps} autoFocus value={value} onChange={onChange} />
                    <div className="text-muted inline-flex items-center space-x-1">
                        <IconMarkdown className={'text-2xl'} />
                        <span>Markdown formatting support</span>
                    </div>
                    {objectStorageAvailable ? (
                        <LemonFileInput
                            accept={'image/*'}
                            multiple={false}
                            alternativeDropTargetRef={dropRef}
                            onChange={setFilesToUpload}
                            loading={uploading}
                            value={filesToUpload}
                        />
                    ) : (
                        <div className="text-muted inline-flex items-center space-x-1">
                            <Tooltip title={'Enable object storage to add images by dragging and dropping.'}>
                                <IconTools className={'text-xl mr-1'} />
                            </Tooltip>
                            <span>
                                Add external images using{' '}
                                <Link to={'https://www.markdownguide.org/basic-syntax/#images-1'}>
                                    {' '}
                                    Markdown image links
                                </Link>
                                .
                            </span>
                        </div>
                    )}
                </div>
            </Tabs.TabPane>
            <Tabs.TabPane tab="Preview" key={'preview-card'}>
                <TextContent text={value} />
            </Tabs.TabPane>
        </Tabs>
    )
}
